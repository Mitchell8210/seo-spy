import type { PlannerLocalState, PlannerTask, TaskEdit, TaskSchedule } from '../types/planner'

const version = 1
export const plannerStorageKey = (businessId: string) => `seo-spy:planner:v${version}:${businessId}`
export const emptyPlannerState = (): PlannerLocalState => ({ edits: {}, completed: {}, custom: [], useWeekends: false })
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const sourceId = (id: string) => /^(website|social|consistency):.+/.test(id)
const customId = (id: string) => /^custom:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
const status = (value: unknown) => value === 'Needs Action' || value === 'Done'
function schedule(value: unknown): value is TaskSchedule {
  if (!record(value) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return false
  const date = new Date(`${value.day}T12:00:00`)
  return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(value.day.slice(0, 4)) && date.getMonth() + 1 === Number(value.day.slice(5, 7)) && date.getDate() === Number(value.day.slice(8, 10))
    && typeof value.hour === 'number' && Number.isInteger(value.hour) && value.hour >= 9 && value.hour <= 16
}
function task(value: unknown, custom: boolean): value is PlannerTask {
  if (!record(value) || typeof value.id !== 'string' || !(custom ? customId(value.id) : sourceId(value.id))) return false
  return typeof value.title === 'string' && value.title.trim().length > 0
    && typeof value.explanation === 'string' && typeof value.guidance === 'string' && typeof value.source === 'string'
    && typeof value.priority === 'string' && ['Urgent', 'Medium', 'Low'].includes(value.priority)
    && typeof value.category === 'string' && ['Admin', 'Content', 'Social', 'Search', 'Review'].includes(value.category)
    && status(value.status) && (custom ? value.mode === 'custom' : value.status === 'Done' && value.mode === (value.id.startsWith('social:') ? 'saved' : 'demo'))
    && (value.schedule === undefined || schedule(value.schedule)) && (value.notes === undefined || typeof value.notes === 'string')
    && (value.destination === undefined || typeof value.destination === 'string' && value.destination.startsWith('/') && !value.destination.startsWith('//'))
}
// Whitelist fields so reports, transient UI state, and unexpected properties never get stored.
function copyTask(value: PlannerTask): PlannerTask {
  return { id: value.id, title: value.title, explanation: value.explanation, guidance: value.guidance, source: value.source,
    priority: value.priority, category: value.category, mode: value.mode, status: value.status,
    ...(value.schedule ? { schedule: { day: value.schedule.day, hour: value.schedule.hour } } : {}),
    ...(value.destination !== undefined ? { destination: value.destination } : {}), ...(value.notes !== undefined ? { notes: value.notes } : {}) }
}
function parseState(value: unknown, businessId: string): PlannerLocalState | null {
  if (!record(value) || value.version !== version || value.businessId !== businessId || !record(value.edits) || !record(value.completed) || !Array.isArray(value.custom) || typeof value.useWeekends !== 'boolean') return null
  const edits: Record<string, TaskEdit> = {}
  const completed: Record<string, PlannerTask> = {}
  const custom: PlannerTask[] = []
  for (const [id, edit] of Object.entries(value.edits)) {
    if ((!sourceId(id) && !customId(id)) || !record(edit) || (edit.status !== undefined && !status(edit.status)) || (edit.schedule !== undefined && edit.schedule !== null && !schedule(edit.schedule))) return null
    edits[id] = { ...(edit.status !== undefined ? { status: edit.status as TaskEdit['status'] } : {}),
      ...(edit.schedule !== undefined ? { schedule: edit.schedule === null ? null : { day: (edit.schedule as TaskSchedule).day, hour: (edit.schedule as TaskSchedule).hour } } : {}) }
  }
  for (const [id, snapshot] of Object.entries(value.completed)) {
    if (!task(snapshot, false) || snapshot.id !== id) return null
    completed[id] = copyTask(snapshot)
  }
  const ids = new Set<string>()
  for (const item of value.custom) {
    if (!task(item, true) || ids.has(item.id)) return null
    ids.add(item.id); custom.push(copyTask(item))
  }
  const state = { edits, completed, custom, useWeekends: value.useWeekends }
  // A valid disabled-weekend state may retain an old snapshot date with an explicit null override.
  if (!state.useWeekends) {
    const schedules = [...custom, ...Object.values(completed)].map(item => edits[item.id]?.schedule === null ? undefined : edits[item.id]?.schedule ?? item.schedule)
    schedules.push(...Object.values(edits).map(edit => edit.schedule ?? undefined))
    if (schedules.some(item => item && [0, 6].includes(new Date(`${item.day}T12:00:00`).getDay()))) return null
  }
  return state
}
export function readPlannerState(businessId: string, storage?: StorageAccess): PlannerLocalState {
  try {
    const raw = (storage ?? window.localStorage).getItem(plannerStorageKey(businessId))
    return raw ? parseState(JSON.parse(raw), businessId) ?? emptyPlannerState() : emptyPlannerState()
  } catch { return emptyPlannerState() }
}
export function writePlannerState(businessId: string, state: PlannerLocalState, storage?: StorageAccess): boolean {
  try {
    const validated = parseState({ version, businessId, ...state }, businessId)
    if (!validated) return false
    const target = storage ?? window.localStorage
    target.setItem(plannerStorageKey(businessId), JSON.stringify({ version, businessId, ...validated }))
    return true
  } catch { return false }
}
// Never treat a pending/failed Facebook read as evidence that saved findings disappeared.
export function reconcilePlannerState(state: PlannerLocalState, source: PlannerTask[], facebookReady: boolean): PlannerLocalState {
  const active = new Set(source.map(item => item.id))
  const custom = new Set(state.custom.map(item => item.id))
  let changed = false
  const edits = { ...state.edits }, completed = { ...state.completed }
  if (!state.useWeekends) {
    const snapshots = new Map([...state.custom, ...Object.values(completed)].map(item => [item.id, item]))
    for (const id of new Set([...Object.keys(edits), ...snapshots.keys()])) {
      const date = edits[id]?.schedule === null ? undefined : edits[id]?.schedule ?? snapshots.get(id)?.schedule
      if (date && [0, 6].includes(new Date(`${date.day}T12:00:00`).getDay())) {
        edits[id] = { ...edits[id], schedule: null }; changed = true
      }
    }
  }
  for (const id of new Set([...Object.keys(edits), ...Object.keys(completed)])) {
    if (active.has(id) || custom.has(id) || id.startsWith('social:') && !facebookReady) continue
    const done = (edits[id]?.status ?? completed[id]?.status) === 'Done'
    if (done && completed[id]) continue // Preserve completed history, not an active source recommendation.
    delete edits[id]; delete completed[id]; changed = true
  }
  return changed ? { ...state, edits, completed } : state
}
