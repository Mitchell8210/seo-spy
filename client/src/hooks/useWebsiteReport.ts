import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { backendApi, BackendApiError } from '../services/backendApi'
import type { Dashboard } from '../types/backend'
import type { WebsiteReport, WebsiteReportSummary } from '../types/websiteApi'
import { selectWebsiteReports, validateWebsiteReport } from '../services/websiteReportSelection'

interface State {
  businessId: string
  requestedReportId?: string
  dashboard: Dashboard | null
  report: WebsiteReport | null
  latestAttempt: WebsiteReportSummary | null
  loading: boolean
  error: string | null
}
const initial = (businessId: string, requestedReportId?: string): State => ({ businessId, requestedReportId, dashboard: null, report: null, latestAttempt: null, loading: true, error: null })
export { validateWebsiteReport } from '../services/websiteReportSelection'

export function useWebsiteReport(businessId: string) {
  const [search] = useSearchParams()
  const requestedReportId = search.get('reportId')?.trim() || undefined
  const [state, setState] = useState<State>(() => initial(businessId, requestedReportId))
  const actions = useRef<{ businessId: string; requestedReportId?: string; refresh: () => Promise<void> } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let current = initial(businessId, requestedReportId)
    let busy = false
    function update(patch: Partial<State>) {
      if (controller.signal.aborted) return
      current = { ...current, ...patch }
      setState(current)
    }
    async function refresh() {
      if (busy || controller.signal.aborted) return
      busy = true
      if (timer) clearTimeout(timer)
      try {
        const [dashboard, list] = await Promise.all([
          backendApi.dashboard(businessId, controller.signal), backendApi.reports(businessId, controller.signal),
        ])
        if (dashboard.business?.id !== businessId || list.businessId !== businessId ||
            list.reports.some(item => item.businessId !== businessId) ||
            (dashboard.activeAudit && dashboard.activeAudit.businessId !== businessId)) {
          throw new BackendApiError('The backend returned a different business.', 'BUSINESS_MISMATCH', 0)
        }
        const { attempts, candidate } = selectWebsiteReports(list.reports, businessId, requestedReportId)
        let report = candidate && current.report?.auditId === candidate.auditId ? current.report : null
        if (candidate && !report) {
          const [saved, summaries, analysis] = await Promise.all([
            backendApi.report(candidate.auditId, controller.signal), backendApi.evidenceSummaries(candidate.auditId, controller.signal),
            backendApi.websiteAnalysis(candidate.auditId, controller.signal),
          ])
          const original = saved.results
          if (!original || analysis.auditId !== candidate.auditId || analysis.version !== 'website-priority-v1' ||
              analysis.findings.length !== original.findings.length || analysis.recommendations.length !== original.recommendations.length ||
              new Set(analysis.findings.map(item => item.id)).size !== analysis.findings.length ||
              new Set(analysis.recommendations.map(item => item.id)).size !== analysis.recommendations.length ||
              analysis.findings.some(item => !original.findings.some(source => source.id === item.id && source.checkId === item.checkId &&
                source.evidenceIds.length === item.evidenceIds.length && item.evidenceIds.every(id => source.evidenceIds.includes(id)))) ||
              analysis.recommendations.some(item => !original.recommendations.some(source => source.id === item.id && source.findingId === item.findingId))) {
            throw new BackendApiError('The website analysis did not match the saved investigation.', 'ANALYSIS_MISMATCH', 0)
          }
          report = validateWebsiteReport({ ...saved, results: { ...original, findings: analysis.findings, recommendations: analysis.recommendations,
            websiteAnalysis: analysis, evidenceSummaries: summaries } }, businessId, candidate.auditId, requestedReportId)
        }
        // Replace the report and its status atomically, retaining old results on read errors.
        update({ dashboard, report, latestAttempt: attempts[0] ?? null, loading: false, error: null })
      } catch (error) {
        update({ loading: false, error: error instanceof BackendApiError ? error.message : 'The saved website report could not be loaded. Please try again.' })
      } finally {
        busy = false
        if (!controller.signal.aborted) timer = setTimeout(() => { void refresh() }, current.dashboard?.activeAudit ? 2500 : 15000)
      }
    }
    // Re-read saved results when returning from the existing investigation flow.
    const onFocus = () => { void refresh() }
    actions.current = { businessId, requestedReportId, refresh }
    window.addEventListener('focus', onFocus)
    void refresh()
    return () => { actions.current = null; controller.abort(); if (timer) clearTimeout(timer); window.removeEventListener('focus', onFocus) }
  }, [businessId, requestedReportId])
  const refresh = useCallback(() => {
    if (actions.current?.businessId === businessId && actions.current.requestedReportId === requestedReportId) void actions.current.refresh()
  }, [businessId, requestedReportId])
  return { ...(state.businessId === businessId && state.requestedReportId === requestedReportId ? state : initial(businessId, requestedReportId)), refresh }
}
