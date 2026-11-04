import type { DragEvent } from 'react'
import { CalendarDays, Check, GripVertical, Layers, Pencil, Plus, RotateCw, Sparkles } from 'lucide-react'
import type { PlannerTask } from '../../types/planner'
import { categoryVisuals, primaryAction, secondaryAction, urgencyVisuals } from './plannerVisuals'

export function PlannerTasks({ tasks, loading, onRescan, onFix, onSchedule, onCreate, dragging, onDragStart, onDragEnd }: {
  tasks: PlannerTask[]; loading: boolean; onRescan: () => void; onFix: (task: PlannerTask, mode: 'ai' | 'manual') => void;
  dragging: string | null; onDragStart: (event: DragEvent<HTMLElement>, id: string) => void; onDragEnd: () => void;
  onSchedule: (task: PlannerTask) => void; onCreate: () => void
}) {
  return <section aria-labelledby="planner-recommendations-title" className="min-w-0 rounded-2xl border border-blue-400/25 bg-surface p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4"><div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/15 text-cyan-300"><Layers size={26} aria-hidden="true" /></span><div><h2 id="planner-recommendations-title" className="text-base font-semibold text-ink">SEO Recommendations</h2><p className="mt-1 text-xs leading-5 text-muted">Tasks from your analysis with AI and manual fix options.</p></div></div><button type="button" onClick={onRescan} disabled={loading} className={secondaryAction}><RotateCw size={14} aria-hidden="true" />Re-scan</button></header>
    <p className="mt-3 text-[11px] leading-5 text-muted">Tasks identify their saved source or demo provenance. Planner choices are stored in the backend after confirmation.</p>
    <div className="mt-4 space-y-3">{tasks.map(task => {
      const { icon: Icon } = categoryVisuals[task.category]
      const urgency = urgencyVisuals[task.priority]
      return <article key={task.id} data-task-id={task.id} draggable title="Drag to the calendar, or use Schedule task" onDragStart={event => {
        if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) { event.preventDefault(); return }
        onDragStart(event, task.id)
      }} onDragEnd={onDragEnd} className={`relative cursor-grab overflow-hidden rounded-xl border border-line bg-elevated/60 p-3 pl-4 active:cursor-grabbing ${dragging === task.id ? 'opacity-50 ring-1 ring-blue-400/50' : ''}`}>
        <span className={`absolute inset-y-0 left-0 w-1 ${task.status === 'Done' ? 'bg-blue-400' : urgency.bar}`} aria-hidden="true" />
        <div className="flex items-start gap-2.5"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${urgency.badge}`}><Icon size={22} aria-hidden="true" /></span><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold leading-5 text-ink">{task.title}</h3><p className="mt-1 text-[10px] text-muted">{task.source} · {task.mode === 'custom' ? 'User-created task' : task.mode === 'saved' ? 'Saved evidence' : 'Demo finding'}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${task.status === 'Done' ? 'border-blue-400/25 text-blue-300' : urgency.pill}`}>{task.status === 'Done' ? 'Done' : task.priority}</span></div>
        <div className="mt-3 grid grid-cols-2 gap-2">{task.status === 'Needs Action' ? <><button type="button" aria-label={`Fix with AI: ${task.title}`} onClick={() => onFix(task, 'ai')} className={primaryAction}><Sparkles size={14} aria-hidden="true" />Fix with AI</button><button type="button" aria-label={`Manual Fix: ${task.title}`} onClick={() => onFix(task, 'manual')} className={secondaryAction}><Pencil size={14} aria-hidden="true" />Manual Fix</button></> : <p className="col-span-2 flex min-h-11 items-center gap-2 text-xs text-blue-300"><Check size={15} aria-hidden="true" />Done · Re-scan later to review the source issue</p>}</div>
        <button type="button" onClick={() => onSchedule(task)} aria-label={`Schedule or reschedule: ${task.title}`} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded text-[11px] text-blue-300 hover:text-blue-200"><CalendarDays size={13} aria-hidden="true" />{task.schedule ? `${task.schedule.day} · ${String(task.schedule.hour).padStart(2, '0')}:00 · Edit` : 'Schedule task'}</button>
        <GripVertical size={14} className="absolute bottom-5 right-3 text-muted" aria-hidden="true" />
      </article>
    })}{tasks.length === 0 && <p className="py-6 text-sm leading-6 text-secondary">No unscheduled tasks are available. You can add your own task.</p>}</div>
    <button type="button" onClick={onCreate} className={`${secondaryAction} mt-4 w-full border-dashed`}><Plus size={16} aria-hidden="true" />Add Custom Task</button>
  </section>
}
