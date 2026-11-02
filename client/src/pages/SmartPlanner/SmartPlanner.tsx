import { useRef, useState, type DragEvent } from 'react'
import { CalendarDays, Lightbulb } from 'lucide-react'
import { PlannerCalendar } from '../../components/planner/PlannerCalendar'
import { PlannerDialog, type PlannerDialogRequest } from '../../components/planner/PlannerDialog'
import { PlannerKpis } from '../../components/planner/PlannerKpis'
import { PlannerTasks } from '../../components/planner/PlannerTasks'
import { PlannerSettingsDialog } from '../../components/planner/PlannerSettingsDialog'
import { PlannerAiDialog } from '../../components/planner/PlannerAiDialog'
import { useSmartPlanner } from '../../hooks/useSmartPlanner'
import { dateKey, mondayOf } from '../../services/smartPlanner'

export function SmartPlanner() {
  const planner = useSmartPlanner()
  const [dragging, setDragging] = useState<string | null>(null)
  function startDrag(event: DragEvent<HTMLElement>, id: string) {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
    setDragging(id)
  }
  function endDrag() { setDragging(null) }
  const [currentWeek] = useState(() => mondayOf(new Date()))
  const [monday, setMonday] = useState(currentWeek)
  const [dialog, setDialog] = useState<PlannerDialogRequest | null>(null)
  const [dialogBusiness, setDialogBusiness] = useState(planner.businessId)
  const [settingsBusiness, setSettingsBusiness] = useState<string | null>(null)
  const [aiBusiness, setAiBusiness] = useState<string | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  function open(request: PlannerDialogRequest) { previousFocus.current = document.activeElement as HTMLElement | null; setDialogBusiness(planner.businessId); setDialog(request) }
  function close() {
    const taskId = dialog?.task?.id
    setDialog(null)
    requestAnimationFrame(() => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
      else if (taskId) document.querySelector<HTMLButtonElement>(`[data-task-id="${CSS.escape(taskId)}"] button`)?.focus()
    })
  }
  return <div className="space-y-6">
    <header className="flex items-center gap-4"><span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/35 bg-blue-500/15 text-cyan-300 shadow-lg shadow-blue-950/25"><span className="relative"><CalendarDays size={34} aria-hidden="true" /><Lightbulb size={15} className="absolute -bottom-1 -right-1 rounded-full bg-surface text-cyan-300" aria-hidden="true" /></span></span><div><h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Smart Planner</h1><p className="mt-2 text-sm leading-6 text-secondary">Turn insights into action with AI or manual fixes, and keep your SEO on track.</p></div></header>
    <PlannerKpis tasks={planner.tasks} monday={currentWeek} />
    <p role="status" aria-live="polite" className="text-xs leading-6 text-blue-200">{planner.message || 'Schedule your next steps. Planner choices are saved to the backend after confirmation.'}</p>
    {planner.error && <p role="alert" className="rounded-lg border border-amber-400/25 p-3 text-xs leading-5 text-amber-200">{planner.error}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
      <PlannerTasks dragging={dragging} onDragStart={startDrag} onDragEnd={endDrag} tasks={planner.tasks.filter(task => !task.schedule)} loading={planner.loading} onRescan={planner.rescan} onFix={(task, kind) => open({ kind, task })} onSchedule={task => open({ kind: 'editor', task })} onCreate={() => open({ kind: 'editor' })} />
      <PlannerCalendar dragging={dragging} onDragStart={startDrag} onDragEnd={endDrag} tasks={planner.tasks} monday={monday} useWeekends={planner.useWeekends} onWeek={direction => setMonday(current => { const next = new Date(current); next.setDate(next.getDate() + direction * 7); return next })} onWeekends={planner.toggleWeekends} onAutoPlan={() => planner.preferences.timeZone ? planner.autoPlan(monday) : setSettingsBusiness(planner.businessId)} onAiPlan={() => setAiBusiness(planner.businessId)} onSettings={() => setSettingsBusiness(planner.businessId)} onManual={() => open({ kind: 'editor' })} onEdit={task => open({ kind: 'editor', task })} onMove={planner.schedule} />
    </div>
    {dialog && dialogBusiness === planner.businessId && <PlannerDialog key={planner.businessId} request={dialog} tasks={planner.tasks} monday={dateKey(monday)} useWeekends={planner.useWeekends} onClose={close} onComplete={planner.complete} onSchedule={planner.schedule} onCreate={planner.addCustom} />}
    {settingsBusiness === planner.businessId && <PlannerSettingsDialog key={`settings:${planner.businessId}`} preferences={planner.preferences} onSave={planner.savePreferences} onClose={() => setSettingsBusiness(null)} />}
    {aiBusiness === planner.businessId && <PlannerAiDialog key={`ai:${planner.businessId}`} businessId={planner.businessId} weekStart={dateKey(monday)} tasks={planner.tasks.map(task => ({ ...task, id: planner.serverId(task.id) ?? task.id }))} onClose={() => setAiBusiness(null)} onReload={planner.reload} />}
  </div>
}
