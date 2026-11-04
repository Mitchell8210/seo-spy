import { PlannerApiError } from './plannerApi'
import { authenticatedWordPressHeaders } from './wordpressFix'
export interface AiSettings { weeklyAvailableMinutes: number; targetUtilization: number; horizonWeeks: number; dailyLimitMinutes: number; workingDays: number[]; protectExistingSchedules: boolean }
export interface AiSettingsResponse { businessId: string; plannerRevision: number; settings: AiSettings; weeklyBudgetMinutes: number }
export interface AiEntry {
  taskId: string; recommendedPriority: 'Urgent' | 'Medium' | 'Low'; estimatedImpact: 'Critical' | 'High' | 'Medium' | 'Low'; impactConfidence: string; impactRationale: string;
  estimatedMinutes: number; effortConfidence: string; effortRationale: string; complexityAssumptions: string[]; dependencies: { required: string[]; suggested: string[] };
  proposedStart: { day: string; hour: number; minute: number } | null; proposedEnd: { day: string; hour: number; minute: number } | null; schedulingRationale: string; deferredReason: string | null
}
export interface AiProposal {
  id: string; businessId: string; plannerRevision: number; mode: 'mock' | 'live'; model: string | null; status: 'generating' | 'ready' | 'invalid' | 'failed' | 'approval_required' | 'applied'; stale: boolean; expired: boolean;
  createdAt: string; appliedAt: string | null; settings: AiSettings; weeklyBudgetMinutes: number; snapshotHash: string;
  tasks: { id: string; title: string; priority: string; sourceSeverity: string | null; protected: boolean; schedule: { day: string; hour: number; minute?: number } | null; estimatedMinutes: number }[];
  output: { schemaVersion: 'planner-muse-proposal-v1'; businessId: string; plannerRevision: number; snapshotHash: string; planningWindow: { start: string; end: string }; entries: AiEntry[]; weeklyWorkloads: { weekStart: string; proposedMinutes: number; existingMinutes: number; totalMinutes: number }[]; tradeoffs: string[]; prioritizationRationale: string } | null;
  diagnostics: { code: string; detail: string; taskId?: string }[]
}
export const effectiveAiBudget = (settings: AiSettings) => Math.floor(settings.weeklyAvailableMinutes * settings.targetUtilization / 100 / 30) * 30
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const int = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max
const string = (value: unknown, maximum = 2000): value is string => typeof value === 'string' && value.length <= maximum
const uuid = (value: unknown) => string(value, 36) && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 60 && value.every(item => string(item))
const invalid = () => new PlannerApiError('The backend returned an invalid AI planning response. Your current calendar was kept.', 502)
function settings(value: unknown): value is AiSettings {
  return object(value) && int(value.weeklyAvailableMinutes, 60, 2400) && Number(value.weeklyAvailableMinutes) % 30 === 0 && int(value.targetUtilization, 10, 90)
    && int(value.horizonWeeks, 2, 52) && int(value.dailyLimitMinutes, 30, 480) && Number(value.dailyLimitMinutes) % 30 === 0 && typeof value.protectExistingSchedules === 'boolean'
    && Array.isArray(value.workingDays) && value.workingDays.length > 0 && value.workingDays.length <= 7 && value.workingDays.every(item => int(item, 1, 7)) && new Set(value.workingDays).size === value.workingDays.length
}
export function parseAiSettings(value: unknown, businessId: string): AiSettingsResponse {
  if (!object(value) || value.businessId !== businessId || !int(value.plannerRevision, 0, Number.MAX_SAFE_INTEGER) || !settings(value.settings) || value.weeklyBudgetMinutes !== effectiveAiBudget(value.settings)) throw invalid()
  return value as unknown as AiSettingsResponse
}
const day = (value: unknown): value is string => string(value, 10) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
const dateTime = (value: unknown) => string(value, 30) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
const duration = (value: unknown) => typeof value === 'number' && [30, 60, 90, 120, 180, 240].includes(value)
const stamp = (value: unknown): value is { day: string; hour: number; minute: number } => object(value) && day(value.day) && int(value.hour, 9, 17) && typeof value.minute === 'number' && [0, 30].includes(value.minute)
export function parseAiProposal(value: unknown, businessId: string): AiProposal | null {
  if (value === null) return null
  if (!object(value) || value.businessId !== businessId || !uuid(value.id) || !int(value.plannerRevision, 0, Number.MAX_SAFE_INTEGER) || !settings(value.settings) || value.weeklyBudgetMinutes !== effectiveAiBudget(value.settings)
    || !['mock', 'live'].includes(String(value.mode)) || !['generating', 'ready', 'invalid', 'failed', 'approval_required', 'applied'].includes(String(value.status)) || typeof value.stale !== 'boolean' || typeof value.expired !== 'boolean'
    || !dateTime(value.createdAt) || value.appliedAt !== null && !dateTime(value.appliedAt) || value.model !== null && !string(value.model) || !string(value.snapshotHash, 64) || !/^[a-f0-9]{64}$/.test(value.snapshotHash)
    || !Array.isArray(value.tasks) || value.tasks.length > 60 || !value.tasks.every(task => object(task) && uuid(task.id) && string(task.title) && ['Urgent', 'Medium', 'Low'].includes(String(task.priority)) && (task.sourceSeverity === null || string(task.sourceSeverity)) && typeof task.protected === 'boolean' && duration(task.estimatedMinutes) && (task.schedule === null || object(task.schedule) && day(task.schedule.day) && int(task.schedule.hour, 9, 16) && (task.schedule.minute === undefined || task.schedule.minute === 0 || task.schedule.minute === 30)))
    || !Array.isArray(value.diagnostics) || value.diagnostics.length > 50 || !value.diagnostics.every(item => object(item) && string(item.code) && string(item.detail))) throw invalid()
  if (value.output !== null) {
    const output = value.output
    if (!object(output) || output.schemaVersion !== 'planner-muse-proposal-v1' || output.businessId !== value.businessId || output.plannerRevision !== value.plannerRevision || output.snapshotHash !== value.snapshotHash || !object(output.planningWindow) || !day(output.planningWindow.start) || !day(output.planningWindow.end) || output.planningWindow.end <= output.planningWindow.start || !Array.isArray(output.entries) || output.entries.length > 60
      || !output.entries.every(entry => object(entry) && uuid(entry.taskId) && ['Urgent', 'Medium', 'Low'].includes(String(entry.recommendedPriority)) && ['Critical', 'High', 'Medium', 'Low'].includes(String(entry.estimatedImpact))
        && ['High', 'Medium', 'Low'].includes(String(entry.impactConfidence)) && ['High', 'Medium', 'Low'].includes(String(entry.effortConfidence)) && duration(entry.estimatedMinutes)
        && string(entry.impactRationale) && string(entry.effortRationale) && string(entry.schedulingRationale) && strings(entry.complexityAssumptions) && object(entry.dependencies) && strings(entry.dependencies.required) && strings(entry.dependencies.suggested)
        && (entry.proposedStart === null || stamp(entry.proposedStart)) && (entry.proposedEnd === null || stamp(entry.proposedEnd)) && (entry.deferredReason === null || string(entry.deferredReason)))
      || !Array.isArray(output.weeklyWorkloads) || output.weeklyWorkloads.length !== value.settings.horizonWeeks || !output.weeklyWorkloads.every(week => object(week) && day(week.weekStart) && int(week.proposedMinutes, 0, 100000) && int(week.existingMinutes, 0, 100000) && week.totalMinutes === Number(week.proposedMinutes) + Number(week.existingMinutes))
      || !strings(output.tradeoffs) || !string(output.prioritizationRationale)) throw invalid()
    const taskIds = new Set(value.tasks.map(task => (task as Record<string, unknown>).id))
    const candidates = new Set(value.tasks.filter(task => !(task as Record<string, unknown>).protected).map(task => (task as Record<string, unknown>).id))
    const entries = output.entries as unknown as AiEntry[], seen = new Set<string>()
    if (taskIds.size !== value.tasks.length || entries.length !== candidates.size) throw invalid()
    for (const entry of entries) {
      if (!candidates.has(entry.taskId) || seen.has(entry.taskId)) throw invalid()
      seen.add(entry.taskId)
      for (const refs of [entry.dependencies.required, entry.dependencies.suggested]) if (new Set(refs).size !== refs.length || refs.some(id => !uuid(id) || id === entry.taskId || !taskIds.has(id))) throw invalid()
      if (!entry.proposedStart) { if (entry.proposedEnd || !entry.deferredReason) throw invalid() }
      else if (!entry.proposedEnd || entry.deferredReason !== null || entry.proposedEnd.day !== entry.proposedStart.day || entry.proposedEnd.hour * 60 + entry.proposedEnd.minute - entry.proposedStart.hour * 60 - entry.proposedStart.minute !== entry.estimatedMinutes || entry.proposedEnd.hour * 60 + entry.proposedEnd.minute > 1020) throw invalid()
    }
  }
  if (['ready', 'applied'].includes(String(value.status)) && value.output === null) throw invalid()
  return value as unknown as AiProposal
}
export async function requestAi(businessId: string, suffix: string, signal: AbortSignal, method = 'GET', body?: object): Promise<unknown> {
  let response: Response
  const live = method === 'POST' && suffix === '/ai-proposals' && object(body) && body.mode === 'live'
  const accountHeaders = live ? await authenticatedWordPressHeaders(businessId) : {}
  try { response = await fetch(`/api/${live ? 'wordpress/' : ''}businesses/${encodeURIComponent(businessId)}/smart-planner${suffix}`, { method, credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(method === 'POST' ? 120000 : 15000)]), headers: { accept: 'application/json', ...accountHeaders, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) }
  catch { throw new PlannerApiError('The AI planning request was not confirmed. Your current calendar was kept. Retry the same action to check its saved outcome safely.', 0) }
  let value: unknown
  try { value = await response.json() } catch { throw invalid() }
  if (!response.ok) throw new PlannerApiError(object(value) && object(value.error) && string(value.error.message) ? value.error.message : 'The AI planning request failed. Your calendar was kept.', response.status)
  return value
}
