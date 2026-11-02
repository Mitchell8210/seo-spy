import type { PlannerPreferences, PlannerTask, TaskSchedule } from '../types/planner'

export interface ServerPlannerTask extends Omit<PlannerTask, 'schedule' | 'destination' | 'notes'> {
  taskKey: string
  schedule: TaskSchedule | null
  destination: string | null
  notes: string | null
}
export interface PlannerResponse {
  businessId: string
  revision: number
  preferences: PlannerPreferences
  tasks: ServerPlannerTask[]
  sources: { channel: 'website' | 'social' | 'consistency'; availability: 'available' | 'empty' | 'pending' | 'unavailable' | 'failed'; reportIds: string[] }[]
  planning?: { policyVersion: 'planner-balanced-v2'; range: { start: string; end: string }; scheduledCount: number; remaining: { taskId: string; reason: string }[]; overloadedDays: string[] }
}
export class PlannerApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const nullableText = (value: unknown) => value === null || text(value)
function validDay(value: unknown): value is string {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value
}
function validSchedule(value: unknown) {
  if (value === null) return true
  if (!record(value) || !text(value.day) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Number.isInteger(value.hour) || Number(value.hour) < 9 || Number(value.hour) > 16 || value.minute !== undefined && value.minute !== 0 && value.minute !== 30) return false
  const day = new Date(`${value.day}T12:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value.day
}
export function parsePlannerResponse(value: unknown, businessId: string): PlannerResponse {
  if (!record(value) || value.businessId !== businessId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !record(value.preferences) || typeof value.preferences.useWeekends !== 'boolean' || !Array.isArray(value.tasks) || !Array.isArray(value.sources)) throw new PlannerApiError('The backend returned an invalid planner response. Your last loaded planner was kept.', 502)
  const ids = new Set<string>(), keys = new Set<string>()
  const preferences = { dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: null, ...value.preferences }
  if (!Number.isInteger(preferences.dailyCapacityMinutes) || Number(preferences.dailyCapacityMinutes) < 30 || Number(preferences.dailyCapacityMinutes) > 480 || Number(preferences.dailyCapacityMinutes) % 30 !== 0
    || !Number.isInteger(preferences.maxTasksPerDay) || Number(preferences.maxTasksPerDay) < 1 || Number(preferences.maxTasksPerDay) > 16
    || !Number.isInteger(preferences.horizonWeeks) || Number(preferences.horizonWeeks) < 1 || Number(preferences.horizonWeeks) > 12
    || preferences.timeZone !== null && !text(preferences.timeZone)) throw new PlannerApiError('The backend returned invalid planning settings.', 502)
  if (preferences.timeZone !== null) { try { new Intl.DateTimeFormat('en-US', { timeZone: preferences.timeZone }).format() } catch { throw new PlannerApiError('The backend returned an invalid planner time zone.', 502) } }
  for (const task of value.tasks) {
    if (!record(task) || !text(task.id) || !task.id || !text(task.taskKey) || !task.taskKey || ids.has(task.id) || keys.has(task.taskKey)
      || !['title', 'explanation', 'guidance', 'source'].every(key => text(task[key]))
      || !text(task.priority) || !['Urgent', 'Medium', 'Low'].includes(task.priority) || !text(task.category) || !['Admin', 'Content', 'Social', 'Search', 'Review'].includes(task.category)
      || !text(task.mode) || !['demo', 'saved', 'custom'].includes(task.mode) || !text(task.status) || !['Needs Action', 'Done'].includes(task.status)
      || !validSchedule(task.schedule) || !nullableText(task.notes) || !nullableText(task.destination)
      || task.estimatedDurationMinutes !== undefined && (typeof task.estimatedDurationMinutes !== 'number' || ![30, 60, 90, 120, 180, 240].includes(task.estimatedDurationMinutes))
      || task.durationEstimateSource !== undefined && (!text(task.durationEstimateSource) || !['default', 'legacy-default', 'user', 'muse-estimate', 'offline-estimate'].includes(task.durationEstimateSource))
      || task.scheduledBy !== undefined && task.scheduledBy !== null && (!text(task.scheduledBy) || !['manual', 'auto', 'legacy-unknown', 'muse', 'offline-preview'].includes(task.scheduledBy))
      || typeof task.destination === 'string' && (!task.destination.startsWith('/') || task.destination.startsWith('//'))) throw new PlannerApiError('The backend returned invalid planner tasks. Your last loaded planner was kept.', 502)
    if (task.schedule && record(task.schedule) && Number(task.schedule.hour) * 60 + Number(task.schedule.minute ?? 0) + Number(task.estimatedDurationMinutes ?? 60) > 1020) throw new PlannerApiError('A planner task extends beyond the supported working window.', 502)
    ids.add(task.id); keys.add(task.taskKey)
  }
  for (const source of value.sources) if (!record(source) || !text(source.channel) || !['website', 'social', 'consistency'].includes(source.channel)
    || !text(source.availability) || !['available', 'empty', 'pending', 'unavailable', 'failed'].includes(source.availability) || !Array.isArray(source.reportIds) || !source.reportIds.every(text)) throw new PlannerApiError('The backend returned invalid planner source information.', 502)
  if (value.planning !== undefined) {
    const planning = value.planning
    if (!record(planning) || planning.policyVersion !== 'planner-balanced-v2' || !record(planning.range) || !validDay(planning.range.start) || !validDay(planning.range.end) || planning.range.start >= planning.range.end
      || !Number.isInteger(planning.scheduledCount) || Number(planning.scheduledCount) < 0 || !Array.isArray(planning.remaining) || !planning.remaining.every(item => record(item) && text(item.taskId) && text(item.reason) && ['duration_exceeds_daily_capacity', 'no_contiguous_slot', 'horizon_capacity_exhausted'].includes(item.reason))
      || !Array.isArray(planning.overloadedDays) || !planning.overloadedDays.every(validDay)) throw new PlannerApiError('The backend returned invalid planning results.', 502)
  }
  return { ...value, preferences } as unknown as PlannerResponse
}
export function plannerTasks(response: PlannerResponse): PlannerTask[] {
  return response.tasks.map(({ taskKey, schedule, destination, notes, ...task }) => ({ ...task, id: taskKey,
    estimatedDurationMinutes: task.estimatedDurationMinutes ?? 60, durationEstimateSource: task.durationEstimateSource ?? 'legacy-default', scheduledBy: task.scheduledBy ?? (schedule ? 'legacy-unknown' : null),
    ...(schedule ? { schedule } : {}), ...(destination !== null ? { destination } : {}), ...(notes !== null ? { notes } : {}) }))
}
export async function requestPlanner(businessId: string, signal: AbortSignal, method: 'GET' | 'POST' | 'PATCH' = 'GET', suffix = '', body?: object): Promise<PlannerResponse> {
  let response: Response
  try {
    response = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/smart-planner${suffix}`, {
      method, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new PlannerApiError(method === 'GET' ? 'The planner could not be loaded. Use Re-scan to retry.' : 'The save was not confirmed. Your last loaded planner was kept. Retry the same action to check or save it safely.', 0)
  }
  let value: unknown
  try { value = await response.json() } catch { throw new PlannerApiError('The planner response could not be read. Your last loaded planner was kept.', response.ok ? 502 : response.status) }
  if (!response.ok) {
    const detail = record(value) && record(value.error) ? value.error : null
    throw new PlannerApiError(detail && text(detail.message) ? detail.message : 'The planner request failed. Your last loaded planner was kept.', response.status)
  }
  return parsePlannerResponse(value, businessId)
}
