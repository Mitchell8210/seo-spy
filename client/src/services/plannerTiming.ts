import type { PlannerTask, TaskSchedule } from '../types/planner'

export const durationChoices = [30, 60, 90, 120, 180, 240] as const
export const defaultPlannerPreferences = { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: null }
export const taskDuration = (task: PlannerTask) => task.estimatedDurationMinutes ?? 60
export const startMinute = (schedule: TaskSchedule) => schedule.hour * 60 + (schedule.minute ?? 0)
export const clockLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export const timeRange = (task: PlannerTask) => task.schedule ? `${clockLabel(startMinute(task.schedule))}–${clockLabel(startMinute(task.schedule) + taskDuration(task))}` : ''
export const durationLabel = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`

/** Position actual intervals without hiding manually overlapping work. */
export function dayTaskLayout(tasks: PlannerTask[], day: string) {
  const scheduled = tasks.filter(task => task.schedule?.day === day).sort((a, b) => startMinute(a.schedule!) - startMinute(b.schedule!) || a.id.localeCompare(b.id))
  const result: { task: PlannerTask; top: number; height: number; left: number; width: number }[] = []
  let group: PlannerTask[] = [], groupEnd = -1
  function finish() {
    const ends: number[] = []
    const columns = group.map(task => {
      const start = startMinute(task.schedule!)
      let lane = ends.findIndex(end => end <= start)
      if (lane < 0) lane = ends.length
      ends[lane] = start + taskDuration(task)
      return lane
    })
    group.forEach((task, index) => result.push({ task, top: (startMinute(task.schedule!) - 540) / 60 * 80,
      height: taskDuration(task) / 60 * 80 - 4, left: columns[index] / ends.length * 100, width: 100 / ends.length }))
    group = []; groupEnd = -1
  }
  for (const task of scheduled) {
    const start = startMinute(task.schedule!)
    if (group.length && start >= groupEnd) finish()
    group.push(task); groupEnd = Math.max(groupEnd, start + taskDuration(task))
  }
  if (group.length) finish()
  return result
}
