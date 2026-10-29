import type { AuditSummary, CreatedAudit, Dashboard, FindingsResponse, LighthouseResponse, RecommendationsResponse, Strategy } from './types'

export class BackendLabApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string

  constructor(message: string, code: string, status: number, requestId?: string) {
    super(message)
    this.name = 'BackendLabApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new BackendLabApiError('The backend took too long to respond. Refresh to check whether an investigation is running.', 'REQUEST_TIMEOUT', 0)
    }
    throw new BackendLabApiError('Cannot reach the backend. Start the API on port 3001 and retry.', 'BACKEND_UNREACHABLE', 0)
  }
  const requestId = response.headers.get('x-request-id') ?? undefined
  let data: unknown
  try { data = await response.json() }
  catch {
    if (signal.aborted) throw signal.reason
    throw new BackendLabApiError('The API did not return JSON. Restart the Vite development server to load its API proxy, confirm the backend is running on port 3001, and retry.', 'INVALID_RESPONSE', response.status, requestId)
  }
  if (!response.ok) {
    const detail = record(data) && record(data.error) ? data.error : {}
    throw new BackendLabApiError(
      typeof detail.message === 'string' ? detail.message : 'The backend request failed. Please retry.',
      typeof detail.code === 'string' ? detail.code : 'REQUEST_FAILED',
      response.status,
      typeof detail.requestId === 'string' ? detail.requestId : requestId,
    )
  }
  if (!record(data)) throw new BackendLabApiError('The backend returned an unexpected response.', 'INVALID_RESPONSE', response.status, requestId)
  return data as T
}

const auditPath = (id: string) => `/audits/${encodeURIComponent(id)}`

export const backendLabApi = {
  dashboard: (businessId: string, signal: AbortSignal) => request<Dashboard>(`/businesses/${encodeURIComponent(businessId)}/dashboard`, signal),
  create: (businessId: string, scope: 'homepage' | 'lighthouse', strategy: Strategy, signal: AbortSignal) => request<CreatedAudit>(
    `/businesses/${encodeURIComponent(businessId)}/audits`, signal, { scope, ...(scope === 'lighthouse' ? { strategy } : {}) },
  ),
  audit: (id: string, signal: AbortSignal) => request<AuditSummary>(auditPath(id), signal),
  findings: (id: string, signal: AbortSignal) => request<FindingsResponse>(`${auditPath(id)}/findings`, signal),
  recommendations: (id: string, signal: AbortSignal) => request<RecommendationsResponse>(`${auditPath(id)}/recommendations`, signal),
  lighthouse: (id: string, signal: AbortSignal) => request<LighthouseResponse>(`${auditPath(id)}/lighthouse`, signal),
}
