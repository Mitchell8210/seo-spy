import { useState, type DragEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, GripVertical, Pencil, Sparkles } from 'lucide-react'
import { dateKey, isWeekend, localDate, mondayOf, plannerHours, weekDays } from '../../services/smartPlanner'
import type { PlannerTask, TaskSchedule } from '../../types/planner'
import { categoryVisuals, primaryAction, secondaryAction, urgencyVisuals } from './plannerVisuals'

export function PlannerCalendar({ tasks, monday, useWeekends, onWeek, onWeekends, onAutoPlan, onManual, onEdit, onMove, dragging, onDragStart, onDragEnd }: {
  dragging: string | null; onDragStart: (event: DragEvent<HTMLElement>, id: string) => void; onDragEnd: () => void;
  tasks: PlannerTask[]; monday: Date; useWeekends: boolean; onWeek: (direction: number) => void; onWeekends: (enabled: boolean) => void;
  onAutoPlan: () => void; onManual: () => void; onEdit: (task: PlannerTask) => void; onMove: (id: string, schedule: TaskSchedule) => void
}) {
  const days = weekDays(monday, useWeekends)
  const [view, setView] = useState<'weekly' | 'monthly'>('weekly')
  const [month, setMonth] = useState(() => new Date(monday.getFullYear(), monday.getMonth(), 1, 12))
  const monthStart = mondayOf(month)
  const monthLength = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const monthCellCount = Math.ceil(((month.getDay() + 6) % 7 + monthLength) / 7) * 7
  const monthDays = Array.from({ length: monthCellCount }, (_, index) => {
    const date = new Date(monthStart); date.setDate(date.getDate() + index); return dateKey(date)
  })
  function moveMonth(direction: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + direction, 1, 12)
    setMonth(next)
    // Anchor scheduling controls to the visible month's first Monday.
    const anchor = mondayOf(next)
    if (anchor.getMonth() !== next.getMonth()) anchor.setDate(anchor.getDate() + 7)
    onWeek(Math.round((anchor.getTime() - monday.getTime()) / (7 * 86400000)))
  }
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const selected = days[Math.min(selectedIndex, days.length - 1)]
  const dateLabel = (day: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', options).format(localDate(day))
  function taskBlock(task: PlannerTask, monthly = false) {
    const { icon: Icon, color } = categoryVisuals[task.category]
    return <button key={task.id} draggable type="button" data-calendar-task={task.id} title={task.title} onClick={() => onEdit(task)}
      onDragStart={event => onDragStart(event, task.id)} onDragEnd={() => { setDropTarget(null); onDragEnd() }}
      aria-label={`Reschedule ${task.title}, ${task.status}`} className={`group flex w-full min-w-0 cursor-grab items-start gap-1 rounded-md border p-1.5 text-left text-[10px] leading-4 active:cursor-grabbing ${task.status === 'Done' ? 'border-blue-400/30 bg-blue-400/10 text-blue-200 opacity-65' : monthly ? urgencyVisuals[task.priority].badge : color}`}>
      <Icon size={12} className="mt-0.5 shrink-0" aria-hidden="true" /><span className={`min-w-0 line-clamp-2 break-words ${task.status === 'Done' ? 'line-through' : ''}`}>{monthly && task.schedule && <span className="mr-1">{String(task.schedule.hour).padStart(2, '0')}:00</span>}{task.title}</span><GripVertical size={10} className="ml-auto shrink-0 opacity-50" aria-hidden="true" />
    </button>
  }
  function cell(day: string, hour: number) {
    const slot = `${day}:${hour}`
    const active = Boolean(dragging && dropTarget === slot)
    return <div key={slot} data-calendar-slot={slot} data-drop-active={active || undefined} onDragOver={event => {
      if (!dragging) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(slot)
    }} onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === slot ? null : current)
    }} onDrop={event => {
      event.preventDefault()
      const id = event.dataTransfer.getData('text/plain')
      if (id === dragging && tasks.some(task => task.id === id)) onMove(id, { day, hour })
      setDropTarget(null); onDragEnd()
    }} className={`min-h-20 min-w-0 space-y-1 border-b border-l border-line p-1 ${active ? 'bg-blue-400/15 ring-1 ring-inset ring-blue-400/70' : day === days[0] ? 'bg-blue-500/[0.035]' : ''}`}>
      {tasks.filter(task => task.schedule?.day === day && task.schedule.hour === hour).map(task => taskBlock(task))}
    </div>
  }
  return <section aria-labelledby="action-planner-title" className="min-w-0 rounded-2xl border border-blue-400/25 bg-surface p-3 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/15 text-cyan-300"><CalendarDays size={27} aria-hidden="true" /></span><div><h2 id="action-planner-title" className="text-base font-semibold text-ink">Smart Action Planner</h2><p className="mt-1 text-xs leading-5 text-muted">Schedule your SEO tasks automatically or manually.</p></div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={onAutoPlan} className={primaryAction}><Sparkles size={14} aria-hidden="true" />Auto Plan (AI)</button><button type="button" onClick={onManual} className={secondaryAction}><Pencil size={14} aria-hidden="true" />Plan Manually</button></div></header>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-elevated/60 p-2">
      <div className="flex min-w-0 items-center gap-1"><button type="button" aria-label={view === 'weekly' ? 'Previous week' : 'Previous month'} onClick={() => view === 'weekly' ? onWeek(-1) : moveMonth(-1)} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-surface"><ChevronLeft size={16} aria-hidden="true" /></button><p className="min-w-0 text-center text-[11px] font-semibold leading-5 text-ink" data-testid="planner-date-range">{view === 'monthly' ? dateLabel(dateKey(month), { month: 'long', year: 'numeric' }) : <>{dateLabel(days[0], { month: 'short', day: 'numeric' })} – {dateLabel(days[days.length - 1], { month: 'short', day: 'numeric', year: 'numeric' })}</>}</p><button type="button" aria-label={view === 'weekly' ? 'Next week' : 'Next month'} onClick={() => view === 'weekly' ? onWeek(1) : moveMonth(1)} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-surface"><ChevronRight size={16} aria-hidden="true" /></button></div>
      <div className="flex flex-wrap items-center gap-3"><button type="button" role="switch" aria-checked={useWeekends} onClick={() => onWeekends(!useWeekends)} className="inline-flex min-h-11 items-center gap-2 rounded text-[11px] font-medium text-secondary"><span className={`flex h-5 w-9 items-center rounded-full border p-0.5 ${useWeekends ? 'border-blue-400 bg-blue-600' : 'border-slate-500 bg-canvas'}`} aria-hidden="true"><span className={`size-3.5 rounded-full bg-white ${useWeekends ? 'translate-x-4' : ''}`} /></span>Use Weekends</button><select aria-label="Calendar view" className="min-h-9 rounded-lg border border-line bg-surface px-2 text-[11px] text-secondary" value={view} onChange={event => {
        const nextView = event.target.value as 'weekly' | 'monthly'
        if (nextView === 'monthly') setMonth(new Date(monday.getFullYear(), monday.getMonth(), 1, 12))
        setDropTarget(null); setView(nextView)
      }}><option value="weekly">Weekly View</option><option value="monthly">Monthly View</option></select></div>
    </div>
    <p className="mt-2 text-[10px] leading-5 text-muted">Auto Plan uses local scheduling rules. Click any task to edit its day/time; desktop tasks can also be dragged.</p>
    {view === 'weekly' ? <>
    <div className="mt-3 hidden overflow-hidden rounded-xl border border-line md:block" data-testid="desktop-week-grid">
      <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-line bg-elevated" aria-hidden="true" />{days.map((day, index) => <div key={day} className={`min-w-0 border-b border-l border-line px-1 py-3 text-center ${index === 0 ? 'bg-blue-500/15 ring-1 ring-inset ring-blue-400/50' : 'bg-elevated'}`}><h3 className="text-[11px] font-semibold text-ink">{dateLabel(day, { weekday: 'short', day: 'numeric' })}</h3><p className="mt-1 min-h-8 text-[9px] leading-4 text-cyan-300">{index === 0 ? 'Office / Admin Day' : ''}</p></div>)}
        {plannerHours.map(hour => <div key={hour} className="contents"><div className="border-b border-line pt-2 text-center text-[10px] text-muted">{hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'pm' : 'am'}</div>{days.map(day => cell(day, hour))}</div>)}
      </div>
    </div>
    <div className="mt-3 md:hidden" data-testid="mobile-day-grid">
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Select planner day">{days.map((day, index) => <button type="button" key={day} aria-pressed={day === selected} onClick={() => setSelectedIndex(index)} className={`min-h-11 min-w-10 flex-1 shrink-0 rounded-lg border px-1 text-[10px] ${day === selected ? 'border-blue-400 bg-blue-500/15 text-cyan-200' : 'border-line text-secondary'}`}>{dateLabel(day, { weekday: 'short' })}<span className="block">{localDate(day).getDate()}</span></button>)}</div>
      <h3 className="mb-2 text-xs font-semibold text-ink">{dateLabel(selected, { weekday: 'long', month: 'short', day: 'numeric' })}{selected === days[0] && <span className="ml-2 text-cyan-300">Office / Admin Day</span>}</h3>
      <div className="grid overflow-hidden rounded-lg border border-line" style={{ gridTemplateColumns: '40px minmax(0, 1fr)' }}>{plannerHours.map(hour => <div key={hour} className="contents"><div className="border-b border-line pt-2 text-center text-[10px] text-muted">{hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'pm' : 'am'}</div>{cell(selected, hour)}</div>)}</div>
    </div>
    </> : <div className="mt-3 overflow-x-auto rounded-xl border border-line" data-testid="monthly-calendar" role="region" aria-label="Monthly planner; scroll horizontally on small screens" tabIndex={0}>
      <div className="grid min-w-[560px] grid-cols-7 sm:min-w-0">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div key={day} className="border-b border-line bg-elevated px-1 py-3 text-center text-[11px] font-semibold text-ink">{day}</div>)}
        {monthDays.map(day => {
          const disabled = !useWeekends && isWeekend(day)
          const outside = localDate(day).getMonth() !== month.getMonth()
          const active = Boolean(dragging && dropTarget === day && !disabled)
          return <div key={day} data-month-day={day} data-in-month={!outside} data-drop-disabled={disabled} data-drop-active={active || undefined}
            onDragOver={event => {
              if (!dragging || disabled) return
              event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(day)
            }} onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === day ? null : current)
            }} onDrop={event => {
              event.preventDefault()
              const id = event.dataTransfer.getData('text/plain')
              const task = tasks.find(item => item.id === id)
              if (!disabled && id === dragging && task) onMove(id, { day, hour: task.schedule?.hour ?? plannerHours[0] })
              setDropTarget(null); onDragEnd()
            }} className={`min-h-28 min-w-0 space-y-1 border-b border-r border-line p-1 ${active ? 'bg-blue-400/15 ring-1 ring-inset ring-blue-400/70' : disabled ? 'bg-canvas/60' : 'bg-surface'} ${outside ? 'opacity-50' : ''}`}>
            <p className={`px-1 pb-1 text-[11px] ${disabled ? 'text-muted' : 'text-secondary'}`}><time dateTime={day}>{localDate(day).getDate()}</time></p>
            {tasks.filter(task => task.schedule?.day === day).sort((a, b) => a.schedule!.hour - b.schedule!.hour || a.id.localeCompare(b.id)).map(task => taskBlock(task, true))}
          </div>
        })}
      </div>
    </div>}
  </section>
}
