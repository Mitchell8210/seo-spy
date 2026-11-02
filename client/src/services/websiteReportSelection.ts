import { BackendApiError } from './backendApi.ts'
import type { WebsiteReport, WebsiteReportSummary } from '../types/websiteApi'

const websiteScope = (scope: string) => scope === 'homepage' || scope === 'lighthouse'
const mismatch = () => new BackendApiError('The saved report did not match this website investigation.', 'REPORT_MISMATCH', 0)

/** Page-scoped evidence is readable only by its explicit saved report ID. */
export function selectWebsiteReports(reports: WebsiteReportSummary[], businessId: string, requestedReportId?: string) {
  if (reports.some(item => item.businessId !== businessId)) throw mismatch()
  const attempts = reports.filter(item => item.mode === 'live' && websiteScope(item.scope))
  if (!requestedReportId) return { attempts, candidate: attempts.find(item => item.status === 'completed' || item.status === 'partial') }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedReportId)) throw mismatch()
  const candidate = reports.find(item => item.reportId === requestedReportId && item.auditId === requestedReportId)
  if (!candidate || candidate.mode !== 'live' || (!websiteScope(candidate.scope) && candidate.scope !== 'wordpress-page') ||
      !['completed', 'partial'].includes(candidate.status)) throw mismatch()
  return { attempts, candidate }
}

export function validateWebsiteReport(record: WebsiteReport, businessId: string, auditId: string, requestedReportId?: string) {
  const results = record.results
  const summaries = results?.evidenceSummaries
  const allowedScope = websiteScope(record.audit?.scope) || record.audit?.scope === 'wordpress-page' && requestedReportId === auditId
  if (record.schemaVersion !== 'seo-spy.audit-report.v1' || record.business?.id !== businessId ||
      record.auditId !== auditId || record.reportId !== auditId || record.audit?.id !== auditId ||
      record.audit.businessId !== businessId || record.audit.mode !== 'live' || !allowedScope ||
      !['completed', 'partial'].includes(record.audit.status) || !results ||
      results.findings.some(item => item.auditId !== auditId || item.evidenceIds.some(id => !results.evidence.some(entry => entry.id === id))) ||
      results.evidence.some(item => item.auditId !== auditId || item.mode !== 'live') ||
      results.recommendations.some(item => item.auditId !== auditId) ||
      !summaries || summaries.auditId !== auditId || summaries.version !== 'programmatic-evidence-v1' ||
      summaries.findings.some(item => typeof item.text !== 'string' || item.text.length > 280 || typeof item.sourceLabel !== 'string' ||
        !results.findings.some(finding => finding.id === item.id && item.evidenceIds.every(id => finding.evidenceIds.includes(id)))) ||
      summaries.checks.some(item => typeof item.text !== 'string' || item.text.length > 280 || typeof item.sourceLabel !== 'string' ||
        !results.lighthouse?.checks.some(check => check.id === item.id))) throw mismatch()
  return record
}
