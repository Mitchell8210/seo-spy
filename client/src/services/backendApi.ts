import type { AuditSummary, CreatedAudit, Dashboard, FindingsResponse, LighthouseResponse, OverallInvestigation, OverallInvestigationStatus, RecommendationsResponse, Strategy } from '../types/backend'
import type { CreatedFacebookReport, FacebookReportJobStatus, FacebookReportResponse } from '../types/facebook'
import type { EvidenceSummaries, WebsiteAnalysis, WebsiteReport, WebsiteReportList } from '../types/websiteApi'
import type { SavedAssessment } from '../types/assessment'
import { authenticatedWordPressHeaders } from './wordpressFix.ts'

export class BackendApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string

  constructor(message: string, code: string, status: number, requestId?: string) {
    super(message)
    this.name = 'BackendApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function request<T>(path: string, signal: AbortSignal, body?: object, timeoutMs = 15000, extraHeaders: Record<string, string> = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      headers: { accept: 'application/json', ...extraHeaders, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new BackendApiError('The backend took too long to respond. Refresh to check whether an investigation is running.', 'REQUEST_TIMEOUT', 0)
    }
    throw new BackendApiError('Cannot reach the backend. Start the API on port 3001 and retry.', 'BACKEND_UNREACHABLE', 0)
  }
  const requestId = response.headers.get('x-request-id') ?? undefined
  let data: unknown
  try { data = await response.json() }
  catch {
    if (signal.aborted) throw signal.reason
    throw new BackendApiError('The API did not return JSON. Restart the Vite development server to load its API proxy, confirm the backend is running on port 3001, and retry.', 'INVALID_RESPONSE', response.status, requestId)
  }
  if (!response.ok) {
    const detail = record(data) && record(data.error) ? data.error : {}
    throw new BackendApiError(
      typeof detail.message === 'string' ? detail.message : 'The backend request failed. Please retry.',
      typeof detail.code === 'string' ? detail.code : 'REQUEST_FAILED',
      response.status,
      typeof detail.requestId === 'string' ? detail.requestId : requestId,
    )
  }
  if (!record(data)) throw new BackendApiError('The backend returned an unexpected response.', 'INVALID_RESPONSE', response.status, requestId)
  return data as T
}

function identifier(id: string) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new BackendApiError('A business or investigation identifier is missing.', 'INVALID_IDENTIFIER', 0)
  }
  return encodeURIComponent(id)
}

const auditPath = (id: string) => `/audits/${identifier(id)}`
async function reportWithAi<T>(businessId: string, kind: 'website' | 'social' | 'overall', signal: AbortSignal, pageId?: string) {
  const headers = await authenticatedWordPressHeaders(businessId)
  signal.throwIfAborted()
  return request<T>(`/wordpress/businesses/${identifier(businessId)}/investigations/${kind}`, signal, { confirmed: true, ...(pageId ? { pageId } : {}) }, 180000, headers)
}

export const backendApi = {
  overallInvestigationStatus: (businessId: string, signal: AbortSignal) => request<OverallInvestigationStatus>(`/facebook/investigations/status?businessId=${identifier(businessId)}`, signal),
  createOverallInvestigation: (businessId: string, signal: AbortSignal) => reportWithAi<OverallInvestigation>(businessId, 'overall', signal),
  createWebsiteReport: (businessId: string, signal: AbortSignal) => reportWithAi<CreatedAudit>(businessId, 'website', signal),
  latestAssessment: (businessId: string, signal: AbortSignal) => request<{ businessId: string; assessment: SavedAssessment | null }>(`/businesses/${identifier(businessId)}/assessments/latest`, signal),
  facebookReportStatus: (businessId: string, signal: AbortSignal) => request<FacebookReportJobStatus>(`/facebook/reports/status?businessId=${identifier(businessId)}`, signal),
  createFacebookReport: (businessId: string, pageId: string, signal: AbortSignal) => reportWithAi<CreatedFacebookReport>(businessId, 'social', signal, pageId),
  websiteAnalysis: (id: string, signal: AbortSignal) => request<WebsiteAnalysis>(`${auditPath(id)}/website-analysis`, signal),
  evidenceSummaries: (id: string, signal: AbortSignal) => request<EvidenceSummaries>(`${auditPath(id)}/evidence-summary`, signal),
  reports: (businessId: string, signal: AbortSignal) => request<WebsiteReportList>(`/businesses/${identifier(businessId)}/reports`, signal),
  report: (id: string, signal: AbortSignal) => request<WebsiteReport>(`${auditPath(id)}/report`, signal),
  facebookReport: (businessId: string, signal: AbortSignal) => request<FacebookReportResponse>(`/businesses/${identifier(businessId)}/facebook-report`, signal),
  dashboard: (businessId: string, signal: AbortSignal) => request<Dashboard>(`/businesses/${identifier(businessId)}/dashboard`, signal),
  create: (businessId: string, scope: 'homepage' | 'lighthouse', strategy: Strategy, signal: AbortSignal) => request<CreatedAudit>(
    `/businesses/${identifier(businessId)}/audits`, signal, { scope, ...(scope === 'lighthouse' ? { strategy } : {}) },
  ),
  audit: (id: string, signal: AbortSignal) => request<AuditSummary>(auditPath(id), signal),
  findings: (id: string, signal: AbortSignal) => request<FindingsResponse>(`${auditPath(id)}/findings`, signal),
  recommendations: (id: string, signal: AbortSignal) => request<RecommendationsResponse>(`${auditPath(id)}/recommendations`, signal),
  lighthouse: (id: string, signal: AbortSignal) => request<LighthouseResponse>(`${auditPath(id)}/lighthouse`, signal),
}
