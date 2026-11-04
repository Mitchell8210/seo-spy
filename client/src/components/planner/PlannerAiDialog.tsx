import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { PlannerApiError, parsePlannerResponse } from '../../services/plannerApi'
import { effectiveAiBudget, parseAiProposal, parseAiSettings, requestAi, type AiProposal, type AiSettings } from '../../services/plannerAi'
import { clockLabel, durationLabel } from '../../services/plannerTiming'
import { primaryAction, secondaryAction } from './plannerVisuals'
import './PlannerAiDialog.css'

const field = 'mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm'
export function PlannerAiDialog({ businessId, weekStart, onClose, onReload }: {
  businessId: string; weekStart: string; onClose: () => void; onReload: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef(new AbortController()), submitting = useRef(false)
  const pending = useRef(new Map<string, { expectedRevision: number; mutationId: string }>())
  const [settings, setSettings] = useState<AiSettings | null>(null), [saved, setSaved] = useState(''), [revision, setRevision] = useState(0)
  const [proposal, setProposal] = useState<AiProposal | null>(null), [scope, setScope] = useState<'all' | 'unscheduled'>('unscheduled'), [mode, setMode] = useState<'live' | 'mock'>('live')
  const [busy, setBusy] = useState('Loading AI planning…'), [error, setError] = useState(''), [message, setMessage] = useState(''), [showPreview, setShowPreview] = useState(false)
  const [applied, setApplied] = useState(false)
  useEffect(() => {
    if (!applied) return
    const timer = window.setTimeout(() => dialog.current?.close(), 2000)
    return () => window.clearTimeout(timer)
  }, [applied])
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; dialog.current?.showModal()
    void Promise.all([requestAi(businessId, '/ai-preferences', abort.signal), requestAi(businessId, '/ai-proposals', abort.signal)]).then(([preferences, latest]) => {
      if (abort.signal.aborted) return
      const loaded = parseAiSettings(preferences, businessId), previous = parseAiProposal(latest, businessId)
      setSettings(loaded.settings); setSaved(JSON.stringify(loaded.settings)); setRevision(loaded.plannerRevision); setProposal(previous)
      setScope(previous?.tasks.some(task => task.schedule && !task.protected) ? 'all' : 'unscheduled')
    }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'AI planning could not be loaded.') }).finally(() => { if (!abort.signal.aborted) setBusy('') })
    return () => abort.abort()
  }, [businessId])
  const dirty = Boolean(settings && JSON.stringify(settings) !== saved)
  function edit(change: Partial<AiSettings>) { setSettings(current => current ? { ...current, ...change } : current) }
  async function mutate<T>(suffix: string, method: string, data: object, expectedRevision: number, label: string, decode: (value: unknown) => T): Promise<T | null> {
    if (submitting.current) return null
    const signature = JSON.stringify([suffix, data]), identity = pending.current.get(signature) ?? { expectedRevision, mutationId: crypto.randomUUID() }
    pending.current.set(signature, identity); submitting.current = true; setBusy(label); setError(''); setMessage('')
    try {
      const result = decode(await requestAi(businessId, suffix, controller.current.signal, method, { ...data, ...identity }))
      if (controller.current.signal.aborted) return null
      pending.current.delete(signature); return result
    } catch (reason) {
      if (!controller.current.signal.aborted) {
        if (reason instanceof PlannerApiError && reason.status > 0 && reason.status < 500) pending.current.delete(signature)
        if (reason instanceof PlannerApiError && reason.status === 409) {
          setProposal(current => current ? { ...current, stale: true } : current)
          try { await onReload(); const value = parseAiSettings(await requestAi(businessId, '/ai-preferences', controller.current.signal), businessId); if (!controller.current.signal.aborted) setRevision(value.plannerRevision) } catch { /* Keep original conflict and inputs; the next explicit action can retry. */ }
        }
        setError(reason instanceof Error ? reason.message : 'The request failed. Your calendar was kept.')
      }
      return null
    } finally { submitting.current = false; if (!controller.current.signal.aborted) setBusy('') }
  }
  async function save() {
    if (!settings) return
    const value = await mutate('/ai-preferences', 'PATCH', { settings }, revision, 'Saving AI planning settings…', value => parseAiSettings(value, businessId))
    if (!value) return
    try { const response = parseAiSettings(value, businessId); setSettings(response.settings); setSaved(JSON.stringify(response.settings)); setRevision(response.plannerRevision); setProposal(current => current && current.status !== 'applied' ? { ...current, stale: true } : current); setMessage('AI planning settings saved.'); await onReload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Saved settings could not be confirmed.') }
  }
  async function generate() {
    const value = await mutate('/ai-proposals', 'POST', { mode, weekStart, scope }, revision, mode === 'live' ? 'Creating your Muse plan…' : 'Building offline proposal…', value => parseAiProposal(value, businessId))
    if (!value) return
    try { setProposal(parseAiProposal(value, businessId)); setShowPreview(true) } catch (reason) { setError(reason instanceof Error ? reason.message : 'The proposal could not be read.') }
  }
  async function apply() {
    if (!proposal) return
    const value = await mutate(`/ai-proposals/${proposal.id}/apply`, 'POST', { confirmed: true }, proposal.plannerRevision, 'Applying the reviewed plan…', value => parsePlannerResponse(value, businessId))
    if (!value) return
    try {
      const response = parsePlannerResponse(value, businessId)
      setRevision(response.revision); setProposal(current => current ? { ...current, status: 'applied' } : null); setBusy('Updating your calendar…')
      await onReload()
      if (!controller.current.signal.aborted) { dialog.current?.scrollTo(0, 0); setApplied(true) }
    } catch { if (!controller.current.signal.aborted) setError('Your plan was saved, but the calendar could not be refreshed. Reload the page to see it.') }
    finally { if (!controller.current.signal.aborted) setBusy('') }
  }
  const title = (id: string) => proposal?.tasks.find(task => task.id === id)?.title ?? id
  const entries = [...(proposal?.output?.entries ?? [])].sort((a, b) => `${a.proposedStart?.day ?? 'z'}:${String(a.proposedStart?.hour ?? 0).padStart(2, '0')}:${a.proposedStart?.minute ?? 0}`.localeCompare(`${b.proposedStart?.day ?? 'z'}:${String(b.proposedStart?.hour ?? 0).padStart(2, '0')}:${b.proposedStart?.minute ?? 0}`))
  return <dialog ref={dialog} onClose={onClose} aria-labelledby="planner-ai-title" className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${!applied && proposal?.output && showPreview ? 'max-w-4xl' : 'max-w-lg'} overflow-y-auto rounded-2xl border border-blue-400/30 bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/75 sm:p-6`}>
    <header className="mb-5 flex items-center justify-between gap-3"><h2 id="planner-ai-title" className="text-lg font-semibold">AI Plan with Muse</h2><button type="button" onClick={() => dialog.current?.close()} aria-label="Close AI planning" className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line"><X size={18} aria-hidden="true" /></button></header>
    {applied ? <div role="status" aria-live="polite" data-testid="ai-plan-applied" className="flex flex-col items-center px-3 py-8 text-center">
      <span className="relative mb-5 flex size-24 items-center justify-center" aria-hidden="true">
        <span className="planner-apply-success-ring absolute inset-0 rounded-full border-2 border-emerald-400/40" />
        <span className="planner-apply-success-icon flex size-20 items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-400/15 text-emerald-300"><Check size={42} strokeWidth={2.5} /></span>
      </span>
      <h3 className="text-xl font-semibold text-ink">Plan applied!</h3>
      <p className="mt-2 text-sm leading-6 text-secondary">Your schedule has been saved.</p>
    </div> : <>
    <p className="mb-4 text-sm leading-6 text-secondary">Choose what to plan. Review the changes before applying them.</p>
    <fieldset disabled={Boolean(busy)} className="space-y-3">
      <legend className="sr-only">What should Muse plan?</legend>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3"><input id="ai-scope-all" type="radio" name="ai-scope" value="all" checked={scope === 'all'} onChange={() => { setScope('all'); setProposal(null); setShowPreview(false) }} className="mt-1" /><span><span className="block text-sm font-semibold">Reorganize entire schedule</span><span className="mt-1 block text-xs leading-5 text-muted">Replan all unfinished tasks, including ones already scheduled.</span></span></label>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3"><input id="ai-scope-unscheduled" type="radio" name="ai-scope" value="unscheduled" checked={scope === 'unscheduled'} onChange={() => { setScope('unscheduled'); setProposal(null); setShowPreview(false) }} className="mt-1" /><span><span className="block text-sm font-semibold">Plan unscheduled tasks only</span><span className="mt-1 block text-xs leading-5 text-muted">Keep everything already on the calendar in place.</span></span></label>
    </fieldset>
    <p className="mt-3 text-xs text-muted">Completed tasks stay unchanged.</p>
    <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer text-xs text-secondary">Advanced options</summary>
    {settings && <form onSubmit={event => { event.preventDefault(); void save() }} className="mt-4 space-y-4">
      <fieldset disabled={Boolean(busy)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-secondary">Weekly available SEO work (hours)<input id="ai-weekly-hours" className={field} type="number" min={1} max={40} step={0.5} required value={settings.weeklyAvailableMinutes / 60} onChange={event => edit({ weeklyAvailableMinutes: Number(event.target.value) * 60 })} /></label>
          <label className="text-xs text-secondary">Target utilization (%)<input id="ai-utilization" className={field} type="number" min={10} max={90} step={1} required value={settings.targetUtilization} onChange={event => edit({ targetUtilization: Number(event.target.value) })} /></label>
          <label className="text-xs text-secondary">Plan ahead (weeks)<input id="ai-horizon" className={field} type="number" min={2} max={52} step={1} required value={settings.horizonWeeks} onChange={event => edit({ horizonWeeks: Number(event.target.value) })} /></label>
          <label className="text-xs text-secondary">Daily workload limit (hours)<input id="ai-daily-hours" className={field} type="number" min={0.5} max={8} step={0.5} required value={settings.dailyLimitMinutes / 60} onChange={event => edit({ dailyLimitMinutes: Number(event.target.value) * 60 })} /></label>
        </div>
        <p data-testid="ai-weekly-budget" className="text-sm text-blue-200">Weekly scheduling budget: {durationLabel(effectiveAiBudget(settings))}, including existing commitments. Remaining availability is reserved for uncertainty.</p>
        <fieldset><legend className="text-xs text-secondary">Working days</legend><div className="mt-2 flex flex-wrap gap-3">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => <label key={label} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" aria-label={`AI working day ${label}`} checked={settings.workingDays.includes(index + 1)} onChange={event => edit({ workingDays: event.target.checked ? [...settings.workingDays, index + 1].sort() : settings.workingDays.filter(day => day !== index + 1) })} />{label}</label>)}</div></fieldset>
        <button type="submit" disabled={!dirty || settings.workingDays.length === 0 || effectiveAiBudget(settings) < 30} className={secondaryAction}>Save AI Settings</button>
      </fieldset>
    </form>}
    <label className="mt-4 block text-xs text-secondary">Generation mode<select id="ai-generation-mode" className={field} disabled={Boolean(busy)} value={mode} onChange={event => setMode(event.target.value as 'live' | 'mock')}><option value="live">Muse — uses shared $25 AI budget</option><option value="mock">Offline preview — no Muse request</option></select></label>
    </details>
    <div className="mt-5"><button type="button" disabled={!settings || Boolean(busy) || dirty} onClick={() => void generate()} className={primaryAction}>Generate Plan</button>{dirty && <p className="mt-2 text-xs text-muted">Save changed settings in Advanced options before generating.</p>}</div>
    <p role="status" aria-live="polite" className="mt-4 text-xs leading-6 text-blue-200">{busy || message}</p>{error && <p role="alert" className="mt-3 rounded-lg border border-amber-400/25 p-3 text-xs text-amber-200">{error}</p>}
    {proposal && <details open={showPreview} onToggle={event => setShowPreview(event.currentTarget.open)} aria-label="AI proposal review" className="mt-4 space-y-4 border-t border-line pt-4"><summary className="cursor-pointer text-sm font-semibold">{proposal.status === 'applied' ? 'Applied plan' : 'Review plan'}</summary>
      <h3 className="font-semibold">{proposal.output ? `Proposed plan · ${proposal.mode === 'mock' ? 'Offline simulation — no Muse request' : 'Muse recommendation'}` : 'Planning request'}</h3>
      <p className="text-xs text-muted">{proposal.status === 'applied' ? 'Applied schedule' : 'Suggestions only — current calendar has not changed'}</p>
      {(proposal.stale || proposal.expired) && proposal.status !== 'applied' && <p role="alert" className="text-sm text-amber-200">This proposal is {proposal.expired ? 'expired' : 'stale because the planner or evidence changed'}. Generate and review a new proposal.</p>}
      {proposal.status === 'generating' && <p className="text-xs text-secondary">Generation is pending or its outcome is uncertain. Reopen this dialog to check the saved proposal. It will not be retried automatically.</p>}
      {proposal.diagnostics.map((item, index) => <p key={index} role="alert" className="text-xs leading-6 text-amber-200">{item.detail}</p>)}
      {proposal.output && <>
        <p className="text-xs text-secondary">{entries.filter(entry => entry.proposedStart).length} planned · {entries.filter(entry => !entry.proposedStart).length} deferred</p>
        {entries.map(entry => <article key={entry.taskId} data-ai-task={entry.taskId} className="space-y-1 rounded-lg border border-line bg-elevated p-3 text-xs leading-6"><h4 className="text-sm font-semibold">{title(entry.taskId)}</h4><p>{entry.proposedStart ? `${entry.proposedStart.day} · ${clockLabel(entry.proposedStart.hour * 60 + entry.proposedStart.minute)}–${clockLabel(entry.proposedEnd!.hour * 60 + entry.proposedEnd!.minute)}` : `Deferred: ${entry.deferredReason}`}</p><p className="text-secondary">{durationLabel(entry.estimatedMinutes)} · {entry.estimatedImpact} estimated impact · {entry.recommendedPriority} priority</p></article>)}
        <details className="space-y-3 text-xs"><summary className="cursor-pointer text-secondary">Workload and reasoning</summary>
        <p className="text-sm leading-6 text-secondary">{proposal.output.prioritizationRationale}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left font-semibold">Weekly workload · includes protected commitments</caption><thead><tr><th className="p-2">Week of</th><th className="p-2">Existing</th><th className="p-2">Proposed</th><th className="p-2">Total / budget</th></tr></thead><tbody>{proposal.output.weeklyWorkloads.map(week => <tr key={week.weekStart} className="border-t border-line"><td className="p-2">{week.weekStart}</td><td className="p-2">{durationLabel(week.existingMinutes)}</td><td className="p-2">{durationLabel(week.proposedMinutes)}</td><td className="p-2">{durationLabel(week.totalMinutes)} / {durationLabel(proposal.weeklyBudgetMinutes)}</td></tr>)}</tbody></table></div>
        {entries.map(entry => <article key={entry.taskId} data-ai-task-details={entry.taskId} className="space-y-2 rounded-lg border border-line bg-elevated p-3 text-xs leading-6"><h4 className="text-sm font-semibold">{title(entry.taskId)}</h4><p>{entry.proposedStart ? `${entry.proposedStart.day} · ${clockLabel(entry.proposedStart.hour * 60 + entry.proposedStart.minute)}–${clockLabel(entry.proposedEnd!.hour * 60 + entry.proposedEnd!.minute)}` : `Deferred: ${entry.deferredReason}`}</p><p>Estimated effort: {durationLabel(entry.estimatedMinutes)} · {entry.effortConfidence} confidence</p><p>Estimated SEO impact: {entry.estimatedImpact} · {entry.impactConfidence} confidence</p><p>Priority: {proposal.tasks.find(task => task.id === entry.taskId)?.priority} → {entry.recommendedPriority} · Source severity: {proposal.tasks.find(task => task.id === entry.taskId)?.sourceSeverity ?? 'Not recorded'}</p><p>{entry.impactRationale}</p><p>{entry.effortRationale}</p><p>{entry.schedulingRationale}</p>{entry.complexityAssumptions.map((item, i) => <p key={i} className="text-muted">Assumption: {item}</p>)}{entry.dependencies.required.length > 0 && <p>Required first: {entry.dependencies.required.map(title).join(', ')}</p>}{entry.dependencies.suggested.length > 0 && <p>Suggested sequence: {entry.dependencies.suggested.map(title).join(', ')}</p>}</article>)}
        <details className="rounded-lg border border-line p-3 text-xs"><summary className="cursor-pointer">Protected scheduled tasks ({proposal.tasks.filter(task => task.protected && task.schedule).length})</summary>{proposal.tasks.filter(task => task.protected && task.schedule).map(task => <p key={task.id} className="mt-2">{task.title} · {task.schedule!.day} · {clockLabel(task.schedule!.hour * 60 + (task.schedule!.minute ?? 0))} · {durationLabel(task.estimatedMinutes)}</p>)}</details>
        {proposal.output.tradeoffs.map((item, index) => <p key={index} className="text-xs leading-6 text-muted">{item}</p>)}
        </details>
        {proposal.status === 'ready' && <button type="button" disabled={Boolean(busy) || proposal.stale || proposal.expired || dirty} onClick={() => void apply()} className={primaryAction}>Apply Plan</button>}
      </>}
    </details>}
    </>}
  </dialog>
}
