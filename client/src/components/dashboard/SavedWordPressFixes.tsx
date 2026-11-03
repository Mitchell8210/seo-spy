import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3 } from 'lucide-react'
import { StatusBadge } from '../common/StatusBadge'
import { wordpressFix, type FixWorkflow } from '../../services/wordpressFix'

interface SavedFix { reportId: string; findingId: string; evidenceId: string; workflow: FixWorkflow & {
  target?: { sourceUrl: string; mediaId: number; pageId: number }; thumbnailUrl?: string | null; pageTitle?: string | null; completedAt?: string | null
} }
const applied = (item: SavedFix) => item.workflow.proposal?.outcome?.status === 'applied' && !item.workflow.proposal.restorationOf
function completedTime(workflow: SavedFix['workflow']) {
  const value = workflow.completedAt ?? workflow.proposal?.outcome?.completedAt
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0
}
function recordedDate(workflow: SavedFix['workflow']) {
  const value = workflow.completedAt ?? workflow.proposal?.outcome?.completedAt
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null
}
export function SavedWordPressFixes({ businessId }: { businessId: string }) {
  const [state, setState] = useState<{ businessId: string; items: SavedFix[]; error: string } | null>(null)
  useEffect(() => {
    let active = true
    const refresh = () => { void wordpressFix.workflows(businessId).then(value => {
      if (active) setState({ businessId, items: value.items.filter(applied).sort((a, b) => completedTime(b.workflow) - completedTime(a.workflow)), error: '' })
    }).catch(error => {
      if (active) setState({ businessId, items: [], error: error instanceof Error ? error.message : 'Saved fix receipts could not be loaded.' })
    }) }
    refresh(); window.addEventListener('wordpress-fix-updated', refresh)
    return () => { active = false; window.removeEventListener('wordpress-fix-updated', refresh) }
  }, [businessId])
  const current = state?.businessId === businessId ? state : null
  return <section aria-label="Recently Fixed" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
    <details className="group/recent-fixes">
    <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-300 sm:px-6 [&::-webkit-details-marker]:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><CheckCircle2 size={18} aria-hidden="true" /></span>
        <h2 className="text-base font-semibold text-ink">Recently Fixed</h2>
        {current && !current.error && <span className="text-xs text-muted">({current.items.length})</span>}
      </div>
      {current && !current.error && <StatusBadge label={`${current.items.filter(item => item.workflow.status === 'public_verified').length} fully verified`} tone="success" />}
      <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open/recent-fixes:rotate-180" aria-hidden="true" />
    </summary>
    <div className="border-t border-line p-4 sm:p-6">
    {current?.error ? <div className="mt-3 space-y-3 text-sm text-secondary">
      <p role="status">{current.error}</p>
      <button type="button" onClick={() => window.dispatchEvent(new Event('wordpress-fix-updated'))} className="min-h-11 rounded-lg border border-blue-400/40 px-3 py-2 text-blue-200 hover:bg-blue-500/10">Retry saved receipts</button>
    </div>
      : !current ? <p role="status" className="mt-3 text-sm text-secondary">Loading saved fix receipts…</p>
      : !current.items.length ? <p className="py-3 text-sm text-secondary">No applied fixes yet. Confirmed updates will appear here with their verification status.</p>
      : <ul className="space-y-4">{current.items.map(({ reportId, findingId, workflow }) => {
        const proposal = workflow.proposal!
        const verified = workflow.status === 'public_verified'
        const receipt = workflow.verification?.receipt
        const storedVerified = receipt ? receipt.storedFieldMatches : proposal.outcome?.verification === 'verified_stored_fields'
        const publicVerified = receipt?.status === 'verified'
        const mismatch = workflow.status === 'stored_mismatch' || workflow.status === 'public_mismatch'
        const status = verified ? 'Verified' : mismatch ? 'Needs attention' : 'Applied · verification pending'
        const date = recordedDate(workflow)
        return <li key={proposal.id} className="rounded-xl border border-line bg-elevated/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {workflow.target?.sourceUrl && <img src={workflow.thumbnailUrl ?? workflow.target.sourceUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { if (event.currentTarget.src !== workflow.target!.sourceUrl) event.currentTarget.src = workflow.target!.sourceUrl }} className="size-16 shrink-0 rounded-lg border border-line bg-surface object-contain" />}
              <div className="min-w-0"><h3 className="font-semibold text-ink">Image description updated</h3><p className="mt-1 break-words text-xs text-muted">{workflow.pageTitle || 'Published website page'} · WordPress media {proposal.resourceId}</p>
                {date && <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Clock3 size={12} aria-hidden="true" />{date}</p>}
              </div>
            </div>
            <StatusBadge label={status} tone={verified ? 'success' : mismatch ? 'critical' : 'medium'} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-3"><dt className="text-xs font-medium text-muted">Before</dt><dd className={`mt-2 break-words leading-6 ${proposal.before.altText === '' ? 'italic text-muted' : 'text-secondary'}`}>{proposal.before.altText === '' ? 'No alternative text' : proposal.before.altText}</dd></div>
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3"><dt className="text-xs font-medium text-emerald-300">After</dt><dd className="mt-2 break-words leading-6 text-ink">{proposal.changes.altText === '' ? 'Empty alternative text' : proposal.changes.altText}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5">
            <p className={storedVerified ? 'flex items-center gap-1.5 text-emerald-300' : 'text-amber-300'}>{storedVerified && <Check size={14} aria-hidden="true" />}Stored WordPress value: {storedVerified ? 'Verified' : receipt?.storedFieldMatches === false ? 'Mismatch' : 'Pending verification'}</p>
            <p className={publicVerified ? 'flex items-center gap-1.5 text-emerald-300' : receipt?.status === 'mismatch' ? 'text-red-300' : 'text-amber-300'}>{publicVerified && <Check size={14} aria-hidden="true" />}Public page HTML: {publicVerified ? 'Verified' : receipt?.status === 'mismatch' ? 'Mismatch' : 'Pending verification'}</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line pt-3 text-xs font-medium">
            <a href={workflow.pageUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline">View affected page<ArrowUpRight size={14} aria-hidden="true" /></a>
            <Link to={`/website?${new URLSearchParams({ businessId, reportId })}`} state={{ findingId }} className="inline-flex min-h-9 items-center gap-1 text-secondary hover:text-ink">Review saved fix<ChevronRight size={14} aria-hidden="true" /></Link>
          </div>
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer py-1 hover:text-secondary">Saved execution details</summary><p className="break-all pt-2 leading-5">Execution: {proposal.id}</p>{receipt && <p className="break-all pt-2 leading-5">Verification receipt: {receipt.id}</p>}{receipt?.limitations.map(item => <p key={item} className="pt-2 leading-5">{item}</p>)}</details>
        </li>
      })}</ul>}
    </div>
    </details>
  </section>
}
