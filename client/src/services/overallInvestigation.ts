import { BackendApiError } from './backendApi.ts'
import type { AuditSummary, Dashboard, LabError, OverallInvestigation, OverallInvestigationStatus } from '../types/backend.ts'

export const OVERALL_INVESTIGATION_POLL_MS = 2500
export interface OverallInvestigationState {
  businessId: string
  audit: AuditSummary | null
  loading: boolean
  submitting: boolean
  error: LabError | null
}
interface InvestigationApi {
  dashboard: (businessId: string, signal: AbortSignal) => Promise<Dashboard>
  audit: (id: string, signal: AbortSignal) => Promise<AuditSummary>
  overallInvestigationStatus: (businessId: string, signal: AbortSignal) => Promise<OverallInvestigationStatus>
  createOverallInvestigation: (businessId: string, signal: AbortSignal) => Promise<OverallInvestigation>
}
export const initialOverallInvestigation = (businessId: string): OverallInvestigationState => ({ businessId, audit: null, loading: true, submitting: false, error: null })
export const investigationActive = (audit: AuditSummary | null) => audit?.status === 'queued' || audit?.status === 'running'
const errorDetail = (error: unknown): LabError => error instanceof BackendApiError
  ? { message: error.message, code: error.code, requestId: error.requestId }
  : { message: 'The investigation status could not be loaded. Please retry.' }

/** Only start() submits work. Initialization, recovery and polling read local status. */
export function createOverallInvestigationSession(businessId: string, api: InvestigationApi, signal: AbortSignal,
  changed: (state: OverallInvestigationState) => void,
  schedule: (callback: () => void) => () => void = callback => {
    const timer = setTimeout(callback, OVERALL_INVESTIGATION_POLL_MS)
    return () => clearTimeout(timer)
  }) {
  let state = initialOverallInvestigation(businessId)
  let known: OverallInvestigation | null = null
  let working = false
  let disposed = false
  let cancelTimer: (() => void) | undefined
  const stopped = () => disposed || signal.aborted
  const update = (patch: Partial<OverallInvestigationState>) => {
    if (stopped()) return
    state = { ...state, ...patch }
    changed(state)
  }
  function validate(job: OverallInvestigation, expectedId?: string) {
    if (!job || typeof job.id !== 'string' || !job.id.trim() || job.businessId !== businessId ||
      job.audit?.id !== job.id || job.audit.businessId !== businessId || job.audit.mode !== 'live' ||
      job.audit.scope !== 'lighthouse' || job.audit.scoringVersion !== 'overall-investigation-v1' ||
      !Number.isFinite(Date.parse(job.audit.createdAt)) ||
      !['queued', 'running', 'completed', 'partial', 'failed'].includes(job.audit.status) ||
      !['queued', 'collecting_evidence', 'evaluating_checks', 'running_lighthouse', 'preparing_recommendations', 'complete', 'failed'].includes(job.audit.stage) ||
      (expectedId !== undefined && job.id !== expectedId) ||
      (job.audit.status === 'completed' && (!job.websiteReportId || !job.facebookReportId || !job.assessmentId))) {
      throw new BackendApiError('The investigation response did not match this business.', 'INVESTIGATION_MISMATCH', 0)
    }
    return job
  }
  async function readStatus(allowDisconnected = false, reconcileMissing = false) {
    let result: OverallInvestigationStatus
    try { result = await api.overallInvestigationStatus(businessId, signal) }
    catch (error) {
      if (allowDisconnected && !known && error instanceof BackendApiError && ['FACEBOOK_RECONNECT_REQUIRED', 'FACEBOOK_SESSION_REQUIRED'].includes(error.code)) return null
      throw error
    }
    if (result.businessId !== businessId) throw new BackendApiError('The backend returned a different business.', 'BUSINESS_MISMATCH', 0)
    if (result.active) validate(result.active)
    if (result.latest) validate(result.latest)
    if (result.active && !investigationActive(result.active.audit)) throw new BackendApiError('The investigation status was inconsistent.', 'INVESTIGATION_MISMATCH', 0)
    const selected = result.active ?? result.latest
    if (known && investigationActive(known.audit) && selected?.id !== known.id) {
      if (reconcileMissing && !selected) { known = null; update({ audit: null }); return null }
      throw new BackendApiError('The overall investigation status is no longer available. Saved channel reports are retained; no work was restarted.', 'INVESTIGATION_STATUS_LOST', 0)
    }
    if (selected) { known = selected; update({ audit: selected.audit }) }
    return selected
  }
  function schedulePoll() {
    cancelTimer?.()
    cancelTimer = undefined
    if (!stopped() && investigationActive(state.audit) && !state.error) cancelTimer = schedule(() => { void poll() })
  }
  async function poll() {
    if (stopped() || working || !investigationActive(state.audit)) return
    working = true
    try {
      if (known) await readStatus()
      else if (state.audit) {
        const id = state.audit.id
        const audit = await api.audit(id, signal)
        if (audit.id !== id || audit.businessId !== businessId || audit.mode !== 'live') throw new BackendApiError('The investigation response did not match this business.', 'AUDIT_MISMATCH', 0)
        update({ audit })
      }
      update({ error: null })
    }
    catch (error) { update({ error: errorDetail(error) }) }
    finally { working = false; schedulePoll() }
  }
  async function refresh() {
    if (stopped() || working) return
    working = true
    cancelTimer?.()
    update({ loading: true, error: null })
    try {
      if (!businessId.trim()) throw new BackendApiError('Choose a business before running an investigation.', 'INVALID_BUSINESS', 0)
      const [dashboard, job] = await Promise.all([api.dashboard(businessId, signal), readStatus(!known, true)])
      if (dashboard.business?.id !== businessId) throw new BackendApiError('The backend returned a different business.', 'BUSINESS_MISMATCH', 0)
      if (!job && !known) {
        const fallback = dashboard.activeAudit ?? dashboard.latestAudit
        if (fallback && fallback.businessId !== businessId) throw new BackendApiError('The backend returned a different business.', 'BUSINESS_MISMATCH', 0)
        update({ audit: fallback?.mode === 'live' ? fallback : null })
      }
      update({ loading: false, error: null })
    } catch (error) { update({ loading: false, error: errorDetail(error) }) }
    finally { working = false; schedulePoll() }
  }
  async function start() {
    if (stopped() || working || state.loading || state.submitting || state.error || investigationActive(state.audit)) return
    working = true
    cancelTimer?.()
    const previousId = known?.id
    const attemptedAt = Date.now()
    update({ submitting: true, error: null })
    try {
      const job = validate(await api.createOverallInvestigation(businessId, signal))
      known = job
      update({ audit: job.audit })
    } catch (error) {
      if (!stopped()) {
        const original = errorDetail(error)
        try {
          // A lost POST response is reconciled by GET, never by resubmitting.
          const recovered = await readStatus()
          if (!recovered || recovered.id === previousId || (!investigationActive(recovered.audit) && Date.parse(recovered.audit.createdAt) < attemptedAt)) update({ error: original })
        } catch { update({ error: original }) }
      }
    } finally { update({ submitting: false }); working = false; schedulePoll() }
  }
  return { refresh, start, poll, dispose: () => { disposed = true; cancelTimer?.() } }
}
