import { useCallback, useEffect, useState } from 'react'
import { BackendApiError, backendApi } from '../services/backendApi'
import type { FacebookReportResponse } from '../types/facebook'

interface State { businessId: string; data: FacebookReportResponse | null; loading: boolean; error: string | null }
const initial = (businessId: string): State => ({ businessId, data: null, loading: true, error: null })

export function useFacebookReport(businessId: string) {
  const [state, setState] = useState<State>(() => initial(businessId))
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    // Keep the last report visible during a refresh, including refresh failures.
    void backendApi.facebookReport(businessId, abort.signal).then(data => {
      if (data.businessId !== businessId || (data.report && (data.report.business.id !== businessId || data.report.audit.businessId !== businessId || data.report.audit.scope !== 'facebook' || data.report.audit.mode !== 'live' || !data.report.results?.facebook))) {
        throw new BackendApiError('The saved report did not match the selected business.', 'REPORT_MISMATCH', 0)
      }
      if (data.analysis && data.analysis.auditId !== data.report?.auditId) throw new BackendApiError('The report analysis did not match its evidence.', 'REPORT_MISMATCH', 0)
      const summaries = data.analysis?.evidenceSummaries
      if (summaries && (summaries.version !== 'programmatic-evidence-v1' || summaries.auditId !== data.report?.auditId ||
          !Array.isArray(summaries.findings) || !Array.isArray(summaries.checks) || summaries.checks.length > 0 ||
          new Set(summaries.findings.map(item => item.id)).size !== summaries.findings.length ||
          summaries.findings.some(item => {
            const finding = data.analysis?.findings.find(finding => finding.id === item.id)
            if (typeof item.text !== 'string' || item.text.length > 280 || typeof item.sourceLabel !== 'string' ||
                !Array.isArray(item.evidenceIds) || !finding || finding.auditId !== data.report?.auditId ||
                item.evidenceIds.length !== finding.evidenceIds.length) return true
            return item.evidenceIds.some(id => !finding.evidenceIds.includes(id) || !data.report?.results.evidence.some(entry =>
              entry.id === id && entry.auditId === summaries.auditId && entry.mode === 'live'))
          }))) {
        throw new BackendApiError('The report analysis did not match its evidence.', 'REPORT_MISMATCH', 0)
      }
      if (!abort.signal.aborted) setState({ businessId, data, loading: false, error: null })
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setState(previous => ({ businessId, data: previous.businessId === businessId ? previous.data : null, loading: false, error: error instanceof Error ? error.message : 'The Facebook report could not be loaded. Please retry.' }))
    })
    return () => abort.abort()
  }, [businessId, revision])
  const refresh = useCallback(() => {
    setState(previous => ({ ...previous, loading: true, error: null }))
    setRevision(value => value + 1)
  }, [])
  return { ...(state.businessId === businessId ? state : initial(businessId)), refresh }
}
