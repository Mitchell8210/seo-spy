import type { DashboardIssue } from './dashboardOpportunities'
import { opportunityTitle } from './dashboardOpportunityCopy'
import type { PlannerTask, TaskSchedule, PlannerLocalState } from '../types/planner'

export const plannerHours = [9, 10, 11, 12, 13, 14, 15, 16]
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function localDate(day: string) { return new Date(`${day}T12:00:00`) }
export function mondayOf(date: Date) {
  const monday = new Date(date)
  monday.setHours(12, 0, 0, 0)
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  return monday
}
export function weekDays(monday: Date, weekends: boolean) {
  return Array.from({ length: weekends ? 7 : 5 }, (_, index) => {
    const date = new Date(monday); date.setDate(date.getDate() + index); return dateKey(date)
  })
}
export function isWeekend(day: string) { return [0, 6].includes(localDate(day).getDay()) }
export function tasksFromIssues(issues: DashboardIssue[]): PlannerTask[] {
  return issues.map(issue => ({
    id: `${issue.category}:${issue.id}`, title: issue.recommendation?.title ?? opportunityTitle(issue.title, issue.explanation),
    explanation: issue.explanation, guidance: issue.recommendation?.explanation ?? 'Review this finding and its source report. Confirm the correct business information before making a change.',
    priority: issue.severity === 'Critical' ? 'Urgent' : issue.severity === 'Low' ? 'Low' : 'Medium',
    category: issue.category === 'consistency' || /hours|phone|contact|business information/i.test(issue.title) ? 'Admin'
      : issue.category === 'social' ? 'Social' : /image|content|heading|alt/i.test(issue.title) ? 'Content' : /meta|search|description|title/i.test(issue.title) ? 'Search' : 'Review',
    source: issue.source, mode: issue.mode, destination: issue.destination, status: 'Needs Action',
  }))
}
export function visibleTasks(source: PlannerTask[], state: PlannerLocalState): PlannerTask[] {
  const sourceIds = new Set(source.map(task => task.id))
  const retainedDone = Object.values(state.completed).filter(task => !sourceIds.has(task.id))
  return [...source, ...retainedDone, ...state.custom].map(task => {
    const edit = state.edits[task.id]
    return { ...task, status: edit?.status ?? task.status, schedule: edit?.schedule === null ? undefined : edit?.schedule ?? task.schedule }
  })
}
export function weeklyCompletion(tasks: PlannerTask[], monday: Date) {
  const days = new Set(weekDays(monday, true))
  const weekly = tasks.filter(task => task.schedule && days.has(task.schedule.day))
  const done = weekly.filter(task => task.status === 'Done').length
  return { done, total: weekly.length, percent: weekly.length ? Math.round(done / weekly.length * 100) : 0 }
}
export function autoSchedule(tasks: PlannerTask[], monday: Date, weekends: boolean) {
  const days = weekDays(monday, weekends)
  const occupied = new Set(tasks.filter(task => task.schedule).map(task => `${task.schedule!.day}:${task.schedule!.hour}`))
  const load = days.map(day => tasks.filter(task => task.schedule?.day === day).length)
  const rank = { Urgent: 0, Medium: 1, Low: 2 }
  const pending = tasks.filter(task => task.status === 'Needs Action' && !task.schedule)
    .sort((a, b) => rank[a.priority] - rank[b.priority] || Number(b.category === 'Admin') - Number(a.category === 'Admin') || a.id.localeCompare(b.id))
  const planned: Record<string, TaskSchedule> = {}
  for (const task of pending) {
    const available = days.map((day, index) => ({ day, index, hour: plannerHours.find(hour => !occupied.has(`${day}:${hour}`)) })).filter(slot => slot.hour !== undefined)
    const preference = task.priority === 'Urgent' ? [0, 1, 2, 3, 4, 5, 6] : task.priority === 'Low' ? [3, 4, 2, 1, 0, 5, 6] : [1, 2, 3, 4, 0, 5, 6]
    available.sort((a, b) => {
      const cost = (index: number) => task.category === 'Admin' && index === 0 && load[0] < 2 ? -10 : load[index] * 3 + preference.indexOf(index)
      return cost(a.index) - cost(b.index) || a.index - b.index
    })
    const slot = available[0]
    if (!slot || slot.hour === undefined) continue
    planned[task.id] = { day: slot.day, hour: slot.hour }
    occupied.add(`${slot.day}:${slot.hour}`); load[slot.index]++
  }
  return planned
}
// Legacy browser-state helper: saved evidence is never proof that completed work failed.
export function reconcileRescan(state: PlannerLocalState): PlannerLocalState { return state }
