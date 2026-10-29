import { useCallback, useEffect, useRef, useState } from 'react'
import { BackendLabApiError, backendLabApi } from './api'
import type { AuditSummary, Dashboard, Evidence, Finding, LabError, LighthouseReport, Recommendation, Strategy } from './types'

export const BACKEND_LAB_POLL_MS = 2500

export function isAuditActive(audit: AuditSummary | null): boolean {
  return audit?.status === 'queued' || audit?.status === 'running'
}

interface LabState {
  businessId: string
  dashboard: Dashboard | null
  displayedAudit: AuditSummary | null
  findings: Finding[]
  evidence: Evidence[]
  recommendations: Recommendation[]
  lighthouse: LighthouseReport | null
  activeAudit: AuditSummary | null
  lastAttempt: AuditSummary | null
  loading: boolean
  submitting: boolean
  error: LabError | null
}

function initialState(businessId: string): LabState {
  return { businessId, dashboard: null, displayedAudit: null, findings: [], evidence: [], recommendations: [], lighthouse: null,
    activeAudit: null, lastAttempt: null, loading: true, submitting: false, error: null }
}

function labError(error: unknown): LabError {
  if (error instanceof BackendLabApiError) return { message: error.message, code: error.code, requestId: error.requestId }
  return { message: 'The investigation data could not be loaded. Please refresh and try again.' }
}

interface SessionActions {
  startAudit: (scope: 'homepage' | 'lighthouse', strategy: Strategy) => Promise<void>
  refresh: () => Promise<void>
}

export function useBackendLab(businessId: string) {
  const [state, setState] = useState<LabState>(() => initialState(businessId))
  const actions = useRef<SessionActions | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let disposed = false
    let busy = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let current = initialState(businessId)

    function update(patch: Partial<LabState>) {
      if (disposed) return
      current = { ...current, ...patch }
      setState(current)
    }

    function clearTimer() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    function schedulePoll() {
      clearTimer()
      if (!disposed && isAuditActive(current.activeAudit) && !current.error) {
        timer = setTimeout(() => { void poll() }, BACKEND_LAB_POLL_MS)
      }
    }

    async function results(audit: AuditSummary) {
      const [findings, recommendations, lighthouse] = await Promise.all([
        backendLabApi.findings(audit.id, signal), backendLabApi.recommendations(audit.id, signal), backendLabApi.lighthouse(audit.id, signal),
      ])
      if ([findings.auditId, recommendations.auditId, lighthouse.auditId].some((id) => id !== audit.id) ||
          findings.findings.some((item) => item.auditId !== audit.id) || findings.evidence.some((item) => item.auditId !== audit.id) ||
          recommendations.recommendations.some((item) => item.auditId !== audit.id)) {
        throw new BackendLabApiError('The backend returned results for a different investigation. Refresh to load a consistent report.', 'AUDIT_MISMATCH', 0)
      }
      return { displayedAudit: audit, findings: findings.findings, evidence: findings.evidence,
        recommendations: recommendations.recommendations, lighthouse: lighthouse.report }
    }

    async function syncDashboard(forceResults = false, terminalAttempt?: AuditSummary) {
      const dashboard = await backendLabApi.dashboard(businessId, signal)
      if (dashboard.business.id !== businessId) throw new BackendLabApiError('The backend returned a different business.', 'BUSINESS_MISMATCH', 0)
      if ([dashboard.latestAudit, dashboard.activeAudit].some((audit) => audit && audit.businessId !== businessId)) {
        throw new BackendLabApiError('The dashboard returned an investigation for a different business.', 'AUDIT_MISMATCH', 0)
      }
      const latest = dashboard.latestAudit
      const loaded = latest && (forceResults || current.displayedAudit?.id !== latest.id)
        ? await results(latest) : null
      const latestAttempt = dashboard.activeAudit ?? terminalAttempt ?? (latest?.id !== current.displayedAudit?.id ? latest : null)
      update({ dashboard, ...(loaded ?? {}), ...(latest ? {} : { displayedAudit: null, findings: [], evidence: [], recommendations: [], lighthouse: null }),
        activeAudit: isAuditActive(dashboard.activeAudit) ? dashboard.activeAudit : null,
        ...(latestAttempt ? { lastAttempt: latestAttempt } : {}), loading: false, error: null })
    }

    async function poll() {
      if (disposed || busy || !current.activeAudit) return
      busy = true
      let terminalAttempt: AuditSummary | undefined
      try {
        const audit = await backendLabApi.audit(current.activeAudit.id, signal)
        if (audit.id !== current.activeAudit.id || audit.businessId !== businessId) throw new BackendLabApiError('The investigation response did not match this business.', 'AUDIT_MISMATCH', 0)
        if (isAuditActive(audit)) {
          update({ lastAttempt: audit, activeAudit: audit, error: null })
        } else {
          terminalAttempt = audit
          // Publish terminal status and its displayed results together, after all endpoints hydrate.
          update({ loading: true, error: null })
          await syncDashboard(true, audit)
        }
      } catch (error) {
        if (!disposed) {
          const detail = labError(error)
          update({ error: terminalAttempt ? { ...detail, message: `The investigation finished, but its report could not be refreshed. Previous results remain visible. ${detail.message}` } : detail,
            loading: false, ...(terminalAttempt ? { activeAudit: null, lastAttempt: terminalAttempt } : {}) })
        }
      } finally {
        busy = false
        schedulePoll()
      }
    }

    async function refresh() {
      if (disposed || busy || current.submitting) return
      busy = true
      clearTimer()
      update({ loading: true, error: null })
      try { await syncDashboard(true) }
      catch (error) { if (!disposed) update({ error: labError(error), loading: false }) }
      finally { busy = false; schedulePoll() }
    }

    async function startAudit(scope: 'homepage' | 'lighthouse', strategy: Strategy) {
      if (disposed || busy || current.submitting || current.loading || isAuditActive(current.activeAudit) || !current.dashboard) return
      const previousCompletedId = current.displayedAudit?.id ?? current.dashboard.latestAudit?.id
      busy = true
      clearTimer()
      update({ submitting: true, error: null })
      try {
        const audit = await backendLabApi.create(businessId, scope, strategy, signal)
        if (audit.businessId !== businessId) throw new BackendLabApiError('The created investigation did not match this business.', 'AUDIT_MISMATCH', 0)
        update({ activeAudit: isAuditActive(audit) ? audit : null, lastAttempt: audit })
        if (!isAuditActive(audit)) await syncDashboard(true)
      } catch (error) {
        if (!disposed) {
          // A POST response can be lost after the server accepted it. Reconcile before allowing another submission.
          const original = labError(error)
          try {
            await syncDashboard()
            const reconciled = current.displayedAudit
            const discoveredCompletedAudit = reconciled && reconciled.id !== previousCompletedId && reconciled.mode === 'live' &&
              (reconciled.status === 'completed' || reconciled.status === 'partial')
            if (!current.activeAudit && !discoveredCompletedAudit) update({ error: original })
          } catch { update({ error: original }) }
        }
      } finally {
        if (!disposed) update({ submitting: false })
        busy = false
        schedulePoll()
      }
    }

    actions.current = { startAudit, refresh }
    busy = true
    void syncDashboard().catch((error: unknown) => {
      if (!disposed) update({ error: labError(error), loading: false })
    }).finally(() => { busy = false; schedulePoll() })

    return () => {
      disposed = true
      controller.abort()
      clearTimer()
      actions.current = null
    }
  }, [businessId])

  const startAudit = useCallback(async (scope: 'homepage' | 'lighthouse', strategy: Strategy) => {
    await actions.current?.startAudit(scope, strategy)
  }, [])
  const refresh = useCallback(async () => { await actions.current?.refresh() }, [])
  const visible = state.businessId === businessId ? state : initialState(businessId)
  return { ...visible, latestAttempt: visible.lastAttempt, startAudit, refresh, retry: refresh }
}
