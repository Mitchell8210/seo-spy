import { ChartColumn, CircleAlert, CircleCheckBig, ClipboardCheck, Flag, Leaf } from 'lucide-react'
import type { PlannerTask } from '../../types/planner'
import { weeklyCompletion } from '../../services/smartPlanner'

export function PlannerKpis({ tasks, monday }: { tasks: PlannerTask[]; monday: Date }) {
  const active = tasks.filter(task => task.status === 'Needs Action')
  const completion = weeklyCompletion(tasks, monday)
  const metrics = [
    { label: 'Active Tasks', value: active.length, icon: ClipboardCheck, color: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300' },
    { label: 'Urgent', value: active.filter(task => task.priority === 'Urgent').length, icon: CircleAlert, color: 'border-red-400/25 bg-red-400/10 text-red-300' },
    { label: 'Medium', value: active.filter(task => task.priority === 'Medium').length, icon: Flag, color: 'border-amber-400/25 bg-amber-400/10 text-amber-300' },
    { label: 'Low', value: active.filter(task => task.priority === 'Low').length, icon: Leaf, color: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' },
    { label: 'Done', value: tasks.filter(task => task.status === 'Done').length, icon: CircleCheckBig, color: 'border-blue-400/25 bg-blue-400/10 text-blue-300' },
    { label: 'Plan Completion (This Week)', value: `${completion.percent}%`, icon: ChartColumn, color: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-300' },
  ]
  return <section aria-label="Planner summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{metrics.map(({ label, value, icon: Icon, color }) => <article key={label} className="min-w-0 rounded-xl border border-line bg-surface p-3 shadow-sm">
    <div className="flex items-center gap-2"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${color}`}><Icon size={22} aria-hidden="true" /></span><p className="text-2xl font-semibold tracking-tight text-ink" data-kpi={label}>{value}</p></div>
    <h2 className="mt-3 text-xs font-medium leading-5 text-secondary">{label}</h2>{label.startsWith('Plan Completion') && <><p className="mt-1 text-[10px] text-muted">{completion.done} of {completion.total} scheduled tasks</p><div className="mt-2 h-1 overflow-hidden rounded bg-elevated"><div className="h-full bg-indigo-400" style={{ width: `${completion.percent}%` }} /></div></>}
  </article>)}</section>
}
