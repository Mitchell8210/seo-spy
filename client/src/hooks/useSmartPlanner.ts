import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router'
import { mockBusiness } from '../data/mockBusiness'
import { PlannerSession } from '../services/plannerSession'
import { dateKey } from '../services/smartPlanner'
import type { PlannerPreferences, PlannerTask, TaskSchedule } from '../types/planner'

export function useSmartPlanner() {
  const [search] = useSearchParams()
  const businessId = search.get('businessId')?.trim() || mockBusiness.id
  const session = useMemo(() => new PlannerSession(businessId), [businessId])
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => session.start(), [session])
  function updateTask(taskKey: string, body: object, message: string) {
    const id = session.serverId(taskKey)
    if (!id) return Promise.resolve(false)
    return session.mutate('PATCH', `/tasks/${encodeURIComponent(id)}`, body, message)
  }
  function complete(task: PlannerTask) {
    return updateTask(task.id, { status: 'Done', completionConfirmed: true }, 'Task marked Done and saved to the backend. No external change or verification was performed.')
  }
  function schedule(id: string, value: TaskSchedule | null, estimatedDurationMinutes?: number) {
    return updateTask(id, { schedule: value, ...(estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes } : {}) }, value ? 'Task schedule saved to the backend.' : estimatedDurationMinutes !== undefined ? 'Task estimate saved to the backend; it remains unscheduled.' : 'Task removed from the calendar and saved; it remains in your task list.')
  }
  function addCustom(task: PlannerTask) {
    return session.mutate('POST', '/tasks', { title: task.title, priority: task.priority, category: task.category, notes: task.notes ?? '', schedule: task.schedule ?? null, ...(task.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: task.estimatedDurationMinutes } : {}) }, 'Custom task saved to the backend. It is not an SEO Spy finding.')
  }
  function toggleWeekends(enabled: boolean) {
    return session.mutate('PATCH', '/preferences', { useWeekends: enabled }, enabled ? 'Weekend scheduling enabled and saved.' : 'Weekend scheduling disabled and saved. Weekend tasks are now unscheduled, not deleted.')
  }
  function autoPlan(monday: Date) {
    return session.mutate('POST', '/auto-plan', { weekStart: dateKey(monday) }, 'Automatic schedule saved using the existing priority and workload rules. Existing schedules were kept. No AI service was called.')
  }
  function savePreferences(preferences: Omit<PlannerPreferences, 'useWeekends'>) {
    return session.mutate('PATCH', '/preferences', preferences, 'Planning settings saved. Existing schedules were kept.')
  }
  return { ...view, businessId, loading: view.loading || view.saving, complete, schedule, addCustom, toggleWeekends, autoPlan, savePreferences, rescan: () => session.refresh(), reload: () => session.reload(), serverId: (key: string) => session.serverId(key) }
}
