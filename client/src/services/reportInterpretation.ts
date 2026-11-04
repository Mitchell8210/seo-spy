import type { InvestigationInterpretation } from '../types/investigationInterpretation'
import type { WebsiteReport } from '../types/websiteApi'
import type { FacebookReportRecord } from '../types/facebook'
import type { DashboardIssue } from './dashboardOpportunities'
import { opportunityDestination } from './dashboardOpportunities.ts'

export function validatedReportRecommendations(interpretation: InvestigationInterpretation | null | undefined, businessId: string, reports: (WebsiteReport | FacebookReportRecord | null | undefined)[]) {
  if (!interpretation || interpretation.schemaVersion !== 'investigation-interpretation-v1' || interpretation.businessId !== businessId || interpretation.status !== 'completed' ||
    typeof interpretation.attemptId !== 'string' || !interpretation.attemptId || !Array.isArray(interpretation.sources) || !Array.isArray(interpretation.recommendations) || interpretation.recommendations.length > 4) return []
  const current = reports.filter(report => report?.business.id === businessId && report.audit.businessId === businessId)
  return interpretation.recommendations.filter(item => {
    if (!item || !item.id || !item.title?.trim() || !item.recommendation?.trim() || !item.rationale?.trim() || !item.verification?.trim() ||
      !['website', 'social', 'consistency'].includes(item.category) || !Array.isArray(item.evidenceRefs) || !item.evidenceRefs.length ||
      item.evidenceRefs.some(ref => !ref || typeof ref.reportId !== 'string' || typeof ref.evidenceId !== 'string') ||
      !current.some(report => report!.auditId === item.reportId)) return false
    const referenced = item.evidenceRefs.map(ref => current.find(report => report!.auditId === ref.reportId))
    if (referenced.some((report, index) => !report || !interpretation.sources.some(source => source?.reportId === report.auditId) ||
      !report.results?.evidence.some(evidence => evidence.id === item.evidenceRefs[index].evidenceId))) return false
    const kinds = new Set(referenced.map(report => report!.audit.scope === 'facebook' ? 'social' : 'website'))
    if (item.category === 'consistency' ? kinds.size !== 2 : kinds.size !== 1 || !kinds.has(item.category)) return false
    if (item.findingId) {
      const finding = current.find(report => report!.auditId === item.reportId)?.results?.findings.find(finding => finding.id === item.findingId)
      if (!finding || !item.evidenceRefs.some(ref => ref.reportId === item.reportId && finding.evidenceIds.includes(ref.evidenceId))) return false
    }
    return true
  })
}

export function interpretationIssues(interpretation: InvestigationInterpretation | null | undefined, businessId: string, reports: (WebsiteReport | FacebookReportRecord | null | undefined)[]): DashboardIssue[] {
  return validatedReportRecommendations(interpretation, businessId, reports).map(item => ({
    id: item.id, title: item.title, explanation: `AI recommendation: ${item.rationale}`, severity: 'Medium', status: 'needs_review',
    source: 'Meta Muse-assisted report', category: item.category, mode: 'saved', destination: opportunityDestination(item.category, businessId), findingId: item.findingId ?? undefined,
    recommendation: { id: item.id, title: item.title, explanation: item.recommendation, status: 'needs_review' },
    fixReview: { id: item.id, title: item.title, category: item.category, source: 'Meta Muse-assisted report', businessId, reportId: item.reportId,
      findingId: item.findingId ?? undefined, explanation: item.rationale, recommendation: item.recommendation, evidenceRefs: item.evidenceRefs, verificationSteps: [item.verification] },
  }))
}
