import { useEffect, useRef, useState } from 'react'
import { mockBusiness } from '../data/mockBusiness'
import { readPlannerState, reconcilePlannerState, writePlannerState } from '../services/plannerPersistence'
import { useDashboardAssessment } from './useDashboardAssessment'
import { autoSchedule, isWeekend, reconcileRescan, tasksFromIssues, visibleTasks } from '../services/smartPlanner'
import type { PlannerLocalState, PlannerTask, TaskSchedule } from '../types/planner'

export function useSmartPlanner() {
  const assessment = useDashboardAssessment()
  const source = tasksFromIssues([...Object.values(assessment.top).flat(), ...assessment.remaining])
  const [local, setLocal] = useState<PlannerLocalState>(() => readPlannerState(mockBusiness.id))
  const [message, setMessage] = useState('')
  const scanning = useRef(false)
  const facebookReady = !assessment.social.loading && !assessment.social.error && Boolean(assessment.social.data?.report)
  const reconciled = reconcilePlannerState(local, source, facebookReady)
  const tasks = visibleTasks(source, reconciled)
  useEffect(() => { writePlannerState(mockBusiness.id, reconciled) }, [reconciled])
  useEffect(() => {
    if ((!scanning.current || assessment.social.loading) && reconciled === local) return
    // Source updates and planner reconciliation happen together after the read settles.
    const timer = setTimeout(() => {
      const rescanFinished = scanning.current && !assessment.social.loading
      if (rescanFinished) scanning.current = false
      setLocal(current => reconcilePlannerState(rescanFinished ? reconcileRescan(current, source, !assessment.social.error) : current, source, facebookReady))
      if (rescanFinished) setMessage(assessment.social.error ? 'Saved Facebook findings could not be refreshed. Their completion state was kept. Demo findings were reviewed locally.' : 'Current saved findings refreshed. Completed tasks still reported as active are back in Needs Action. Website and consistency remain demo data; no provider scan was started.')
    }, 0)
    return () => clearTimeout(timer)
  }, [assessment.social.loading, assessment.social.error, source, facebookReady, reconciled, local])

  function complete(task: PlannerTask) {
    setLocal(current => ({ ...current, edits: { ...current.edits, [task.id]: { ...current.edits[task.id], status: 'Done' } },
      completed: task.mode === 'custom' ? current.completed : { ...current.completed, [task.id]: { ...task, status: 'Done' } } }))
    setMessage('Task marked Done in this planner. No external change or verification was performed.')
  }
  function schedule(id: string, value: TaskSchedule | null) {
    if (value && !local.useWeekends && isWeekend(value.day)) { setMessage('Enable Use Weekends before scheduling on Saturday or Sunday.'); return }
    setLocal(current => ({ ...current, edits: { ...current.edits, [id]: { ...current.edits[id], schedule: value } } }))
    setMessage(value ? 'Task scheduled in this planner.' : 'Task removed from the calendar; it remains in your task list.')
  }
  function addCustom(task: PlannerTask) { setLocal(current => ({ ...current, custom: [...current.custom, task] })); setMessage('Custom task added locally. It is not an SEO Spy finding.') }
  function toggleWeekends(enabled: boolean) {
    setLocal(current => {
      const edits = { ...current.edits }
      if (!enabled) for (const task of tasks) if (task.schedule && isWeekend(task.schedule.day)) edits[task.id] = { ...edits[task.id], schedule: null }
      return { ...current, useWeekends: enabled, edits }
    })
    setMessage(enabled ? 'Weekend scheduling enabled.' : 'Weekend scheduling disabled. Any weekend tasks are now unscheduled, not deleted.')
  }
  function autoPlan(monday: Date) {
    const planned = autoSchedule(tasks, monday, local.useWeekends)
    setLocal(current => ({ ...current, edits: { ...current.edits, ...Object.fromEntries(Object.entries(planned).map(([id, value]) => [id, { ...current.edits[id], schedule: value }])) } }))
    setMessage(`Scheduled ${Object.keys(planned).length} unscheduled tasks using local priority and workload rules. Existing schedules were kept. No AI service was called.`)
  }
  function rescan() { scanning.current = true; assessment.social.refresh(); setMessage('Refreshing saved findings. No new provider scan or external change will be started.') }
  return { tasks, source, message, useWeekends: local.useWeekends, loading: assessment.social.loading, error: assessment.social.error,
    complete, schedule, addCustom, toggleWeekends, autoPlan, rescan }
}
