import type { AnalyticsData } from '../pages/Analysis/analysisRevenue'

export interface AnalysisView { data: AnalyticsData; caption: string }
export const emptyAnalytics = (): AnalyticsData => ({ source: 'unavailable', period: '30-day analytics', daily: [], channels: [], devices: [], pages: [] })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const events = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const errors: Record<string, string> = {
  GOOGLE_NOT_CONFIGURED: 'Google Analytics is not configured for this website.',
  GOOGLE_PERMISSION_DENIED: 'Google Analytics access is unavailable. Check the property permissions.',
  GOOGLE_AUTH_FAILED: 'Google Analytics authorization is unavailable.',
  GOOGLE_API_DISABLED: 'The Google Analytics reporting API is not enabled.',
  GOOGLE_RATE_LIMITED: 'Google Analytics reporting is temporarily limited. No automatic retry was attempted.',
  GOOGLE_CACHE_UNAVAILABLE: 'Saved Google Analytics reporting is unavailable.',
}
const invalid = () => new Error('Google Analytics returned an incompatible report. Traffic is unavailable.')

export function mapAnalysisResponse(value: unknown, businessId: string): AnalysisView {
  if (!record(value) || value.schemaVersion !== 'seo-spy.google-analysis.v2' || value.businessId !== businessId || value.provider !== 'ga4' ||
    !['available', 'empty', 'unavailable'].includes(String(value.availability)) || !record(value.cache) || typeof value.cache.stale !== 'boolean') throw invalid()
  if (value.availability === 'unavailable' || value.errorCode || value.cache.stale) {
    return { data: emptyAnalytics(), caption: errors[String(value.errorCode)] ?? 'Google Analytics is unavailable. No automatic retry was attempted.' }
  }
  const data = value.data
  if (!record(data) || data.schemaVersion !== 'seo-spy.google-analysis-data.v2' || !text(data.hostname) || !text(data.collectedAt) ||
    !record(data.dateRange) || !date(data.dateRange.startDate) || !date(data.dateRange.endDate) || !text(data.dateRange.timeZone) ||
    Date.parse(data.dateRange.endDate) - Date.parse(data.dateRange.startDate) !== 29 * 86400000 ||
    !record(data.totals) || !count(data.totals.users) || !count(data.totals.sessions) || data.totals.conversions !== null && !count(data.totals.conversions) ||
    data.totals.rate !== null && (!events(data.totals.rate) || data.totals.rate > 100) || !Array.isArray(data.metadata) || data.metadata.length < 5 || data.metadata.length > 7 ||
    !Array.isArray(data.daily) || data.daily.length > 30 || !Array.isArray(data.channels) || data.channels.length > 100 ||
    !Array.isArray(data.devices) || data.devices.length > 20 || !Array.isArray(data.pages) || data.pages.length > 5) throw invalid()
  const range = data.dateRange
  try { new Intl.DateTimeFormat('en', { timeZone: range.timeZone as string }).format(new Date(data.collectedAt)) } catch { throw invalid() }
  const daily: AnalyticsData['daily'] = data.daily.map(row => {
    if (!record(row) || !date(row.date) || row.date < String(range.startDate) || row.date > String(range.endDate) || !count(row.users) || !count(row.sessions) || row.conversions !== null && !count(row.conversions)) throw invalid()
    return { date: row.date, day: Math.round((Date.parse(row.date) - Date.parse(String(range.startDate))) / 86400000) + 1, users: row.users, sessions: row.sessions, conversions: row.conversions }
  }).sort((a, b) => a.day - b.day)
  const breakdown = (rows: unknown[]): { label: string; value: number }[] => rows.map(row => {
    if (!record(row) || !text(row.label) || !count(row.value)) throw invalid()
    return { label: row.label, value: row.value }
  })
  const channels = breakdown(data.channels), devices = breakdown(data.devices)
  const pages = data.pages.map(row => {
    if (!record(row) || !text(row.path) || !count(row.users)) throw invalid()
    return { path: row.path, users: row.users }
  })
  for (const keys of [daily.map(row => row.date), channels.map(row => row.label), devices.map(row => row.label), pages.map(row => row.path)]) if (new Set(keys).size !== keys.length) throw invalid()
  for (const item of data.metadata) {
    if (!record(item) || typeof item.subjectToThresholding !== 'boolean' || typeof item.dataLossFromOtherRow !== 'boolean' || !Array.isArray(item.sampling) ||
      item.sampling.some(sample => !record(sample) || typeof sample.samplesReadCount !== 'string' || typeof sample.samplingSpaceSize !== 'string' ||
        !/^\d{1,30}$/.test(sample.samplesReadCount) || !/^\d{1,30}$/.test(sample.samplingSpaceSize) || BigInt(sample.samplesReadCount) > BigInt(sample.samplingSpaceSize))) throw invalid()
  }
  const period = `${range.startDate} – ${range.endDate} (${range.timeZone})`
  const conversion = data.conversion
  if (!record(conversion) || !['available', 'unavailable'].includes(String(conversion.status)) ||
    conversion.status === 'available' && (!count(conversion.users) || !text(conversion.eventName) || !Array.isArray(conversion.pagePaths) ||
      data.totals.conversions === null || data.totals.rate === null || conversion.users > data.totals.users || conversion.users > data.totals.conversions ||
      Math.abs(data.totals.rate - (data.totals.users ? conversion.users / data.totals.users * 100 : 0)) > 0.000001) ||
    conversion.status === 'unavailable' && (data.totals.conversions !== null || data.totals.rate !== null || daily.some(day => day.conversions !== null))) throw invalid()
  return { data: { source: 'ga4', period, daily, channels, devices, pages, totals: { users: data.totals.users, sessions: data.totals.sessions, conversions: data.totals.conversions, rate: data.totals.rate } },
    caption: `Google Analytics · ${data.hostname} · Past 30 days` }
}

export async function loadAnalysis(businessId: string, signal: AbortSignal): Promise<AnalysisView> {
  const response = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/analytics`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  })
  if (!response.ok) throw new Error('Google Analytics could not be loaded for this website.')
  return mapAnalysisResponse(await response.json(), businessId)
}
