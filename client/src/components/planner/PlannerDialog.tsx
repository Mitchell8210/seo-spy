import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, Sparkles, X } from 'lucide-react'
import { Link } from 'react-router'
import { isWeekend, plannerHours } from '../../services/smartPlanner'
import type { PlannerTask, TaskCategory, TaskPriority, TaskSchedule } from '../../types/planner'
import { primaryAction, secondaryAction } from './plannerVisuals'
import { durationChoices, durationLabel, taskDuration } from '../../services/plannerTiming'

export type PlannerDialogRequest = { kind: 'ai' | 'manual'; task: PlannerTask } | { kind: 'editor'; task?: PlannerTask }
export function PlannerDialog({ request, tasks, monday, useWeekends, onClose, onComplete, onSchedule, onCreate }: {
  request: PlannerDialogRequest; tasks: PlannerTask[]; monday: string; useWeekends: boolean; onClose: () => void;
  onComplete: (task: PlannerTask) => Promise<boolean>; onSchedule: (id: string, schedule: TaskSchedule | null, estimatedDurationMinutes?: number) => Promise<boolean>; onCreate: (task: PlannerTask) => Promise<boolean>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [selectedId, setSelectedId] = useState(request.task?.id ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const selectedTask = tasks.find(task => task.id === selectedId)
  const submitting = useRef(false)
  async function save(action: () => Promise<boolean>) {
    if (submitting.current) return
    submitting.current = true; setSaving(true); setError('')
    try { if (await action()) ref.current?.close(); else setError('Your change was not confirmed. Your entries are kept; review the planner message and retry.') }
    finally { submitting.current = false; setSaving(false) }
  }
  useEffect(() => { ref.current?.showModal() }, [])
  const title = request.kind === 'editor' ? 'Plan your task' : request.kind === 'ai' ? 'AI-assisted fix preview' : 'Manual fix guidance'
  return <dialog ref={ref} aria-labelledby="planner-dialog-title" onClose={onClose} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-blue-400/30 bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/75 sm:p-6">
    <header className="mb-5 flex items-center justify-between gap-3"><h2 id="planner-dialog-title" className="flex items-center gap-2 text-lg font-semibold">{request.kind === 'ai' ? <Sparkles size={22} className="text-blue-300" aria-hidden="true" /> : <Pencil size={22} className="text-cyan-300" aria-hidden="true" />}{title}</h2><button type="button" onClick={() => ref.current?.close()} aria-label="Close planner dialog" className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line"><X size={18} aria-hidden="true" /></button></header>
    {request.kind === 'editor' ? <>
      <label htmlFor="planner-task-choice" className="text-xs font-medium text-secondary">Task</label><select id="planner-task-choice" value={selectedId} disabled={saving} onChange={event => { setSelectedId(event.target.value); setConfirmed(false); setError('') }} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm"><option value="">Create a custom task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select>
      {selectedTask && <section aria-label="Task details" className="mt-4 rounded-xl border border-line bg-elevated p-4">
        <h3 className="break-words text-base font-semibold leading-6">{selectedTask.title}</h3>
        <p className="mt-2 text-xs text-muted">{selectedTask.source} · {selectedTask.mode === 'saved' ? 'Saved evidence' : selectedTask.mode === 'demo' ? 'Demo finding' : 'User-created task'}</p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <div><dt className="text-muted">Priority</dt><dd className="mt-1 break-words text-secondary">{selectedTask.priority}</dd></div>
          <div><dt className="text-muted">Category</dt><dd className="mt-1 break-words text-secondary">{selectedTask.category}</dd></div>
          <div><dt className="text-muted">Status</dt><dd className="mt-1 break-words text-secondary">{selectedTask.status}</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-muted">Estimated duration: {durationLabel(taskDuration(selectedTask))} · {selectedTask.durationEstimateSource === 'user' ? 'Your estimate' : 'Default planning estimate'}{selectedTask.status === 'Done' ? ' · Historical estimate is read-only' : ''}</p>
        {selectedTask.explanation && <div className="mt-4"><h4 className="text-sm font-semibold">Description</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-secondary">{selectedTask.explanation}</p></div>}
        {selectedTask.guidance && selectedTask.guidance !== selectedTask.explanation && <div className="mt-4"><h4 className="text-sm font-semibold">Suggested steps</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-secondary">{selectedTask.guidance}</p></div>}
        {selectedTask.notes && selectedTask.notes !== selectedTask.explanation && selectedTask.notes !== selectedTask.guidance && <div className="mt-4"><h4 className="text-sm font-semibold">Notes</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-secondary">{selectedTask.notes}</p></div>}
        {selectedTask.destination && <Link to={selectedTask.destination} className="mt-3 inline-flex min-h-11 items-center rounded text-xs font-medium text-blue-300 hover:underline">Open source report</Link>}
        {selectedTask.status === 'Needs Action' && <>
          <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6 text-secondary"><input type="checkbox" checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-500" />I completed these steps outside SEO Spy.</label>
          <p className="mt-2 text-xs leading-5 text-muted">Done records your completion. It does not verify that the source issue is resolved.</p>
          <button type="button" disabled={!confirmed || saving} onClick={() => { void save(() => onComplete(selectedTask)) }} className={`${primaryAction} mt-3 w-full`}><Check size={15} aria-hidden="true" />Mark as Done</button>
        </>}
      </section>}
      <form key={selectedId} className="mt-4 space-y-4" onSubmit={event => {
        event.preventDefault(); const values = new FormData(event.currentTarget)
        const day = String(values.get('day') ?? ''); const time = Number(values.get('hour')); const hour = Math.floor(time); const minute: 0 | 30 = time % 1 === 0.5 ? 30 : 0
        const chosenDuration = Number(values.get('estimatedDurationMinutes'))
        const estimatedDurationMinutes = selectedTask?.status === 'Done' || chosenDuration === (selectedTask ? taskDuration(selectedTask) : 60) ? undefined : chosenDuration
        if (day && !useWeekends && isWeekend(day)) { setError('Enable Use Weekends before scheduling on Saturday or Sunday.'); return }
        if (day && hour * 60 + minute + (estimatedDurationMinutes ?? (selectedTask ? taskDuration(selectedTask) : 60)) > 1020) { setError('Choose an earlier start or shorter estimate so the task ends by 17:00.'); return }
        const schedule = day ? { day, hour, minute } : undefined
        if (selectedId) void save(() => onSchedule(selectedId, schedule ?? null, estimatedDurationMinutes))
        else {
          const name = String(values.get('title') ?? '').trim(); if (!name) { setError('Enter a task name.'); return }
          void save(() => onCreate({ id: `custom:${crypto.randomUUID()}`, title: name, priority: String(values.get('priority')) as TaskPriority,
            category: String(values.get('category')) as TaskCategory, explanation: String(values.get('notes') ?? '').trim(), guidance: String(values.get('notes') ?? '').trim() || 'Complete the work you described, then mark this custom task Done.',
            source: 'Custom task', mode: 'custom', status: 'Needs Action', schedule, estimatedDurationMinutes, durationEstimateSource: estimatedDurationMinutes === undefined ? 'default' : 'user', notes: String(values.get('notes') ?? '').trim() }))
        }
      }}>
        {!selectedId && <><div><label htmlFor="planner-task-name" className="text-xs font-medium text-secondary">Task Name</label><input id="planner-task-name" name="title" maxLength={160} required className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm" /></div><div className="grid grid-cols-2 gap-3"><div><label htmlFor="planner-priority" className="text-xs text-secondary">Priority</label><select id="planner-priority" name="priority" defaultValue="Medium" className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-2 text-sm"><option>Urgent</option><option>Medium</option><option>Low</option></select></div><div><label htmlFor="planner-category" className="text-xs text-secondary">Category</label><select id="planner-category" name="category" defaultValue="Admin" className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-2 text-sm">{['Admin', 'Content', 'Social', 'Search', 'Review'].map(category => <option key={category}>{category}</option>)}</select></div></div></>}
        <div><label htmlFor="planner-duration" className="text-xs font-medium text-secondary">Estimated duration</label><select id="planner-duration" name="estimatedDurationMinutes" disabled={selectedTask?.status === 'Done'} defaultValue={selectedTask ? taskDuration(selectedTask) : 60} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm">{durationChoices.map(duration => <option key={duration} value={duration}>{durationLabel(duration)}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3"><div className="min-w-0"><label htmlFor="planner-day" className="text-xs text-secondary">Day (optional)</label><input id="planner-day" name="day" type="date" defaultValue={selectedTask ? selectedTask.schedule?.day ?? '' : monday} className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-elevated px-2 text-xs" /></div><div><label htmlFor="planner-hour" className="text-xs text-secondary">Time</label><select id="planner-hour" name="hour" defaultValue={(selectedTask?.schedule?.hour ?? 9) + (selectedTask?.schedule?.minute ?? 0) / 60} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-2 text-sm">{plannerHours.flatMap(hour => [0, 30].map(minute => <option key={`${hour}:${minute}`} value={hour + minute / 60}>{String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}</option>))}</select></div></div>
        {!selectedId && <div><label htmlFor="planner-notes" className="text-xs text-secondary">Notes (optional)</label><textarea id="planner-notes" name="notes" rows={3} maxLength={2000} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-sm" /><p className="mt-1 text-[11px] text-muted">User-created planner task · Not an SEO Spy finding</p></div>}
        <p role="alert" className="text-xs text-red-300">{saving ? 'Saving planner changes…' : error}</p><div className="flex flex-wrap gap-2"><button type="submit" disabled={saving} className={primaryAction}>{selectedId ? 'Save Schedule' : 'Add Task'}</button>{selectedId && <button type="button" disabled={saving} onClick={() => { void save(() => onSchedule(selectedId, null)) }} className={secondaryAction}>Unschedule</button>}<button type="button" onClick={() => ref.current?.close()} className={secondaryAction}>Cancel</button></div>
      </form>
    </> : <>
      <h3 className="text-base font-semibold leading-6">{request.task.title}</h3><p className="mt-2 text-xs text-muted">{request.task.source} · {request.task.mode === 'saved' ? 'Saved evidence' : request.task.mode === 'demo' ? 'Demo finding' : 'User-created task'}</p>
      {request.kind === 'ai' && <p className="mt-4 rounded-lg border border-blue-400/25 bg-elevated p-3 text-xs leading-6 text-blue-200">Preview using existing guidance. No AI service is called and no website or account is changed.</p>}
      <div className="mt-4 rounded-xl border border-line bg-elevated p-4"><h4 className="text-sm font-semibold">Suggested steps</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-secondary">{request.task.guidance}</p>{request.task.destination && <Link to={request.task.destination} className="mt-3 inline-flex min-h-11 items-center rounded text-xs font-medium text-blue-300 hover:underline">Open source report</Link>}</div>
      <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6 text-secondary"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-500" />I completed these steps outside SEO Spy.</label>
      <p className="mt-2 text-xs leading-5 text-muted">{saving ? 'Saving completion to the backend…' : error || 'Done records your completion. It does not verify that the source issue is resolved. Re-scan refreshes saved evidence without reopening completed tasks.'}</p>
      <button type="button" disabled={!confirmed || saving} onClick={() => { void save(() => onComplete(request.task)) }} className={`${primaryAction} mt-5 w-full`}><Check size={15} aria-hidden="true" />Mark as Done</button>
    </>}
  </dialog>
}
