import type { Dashboard } from '../types/backend'
import type { FacebookReportResponse } from '../types/facebook'
import type { WebsiteReport } from '../types/websiteApi'
import { mapDashboardReports } from './dashboardMapping.ts'
import { opportunityDestination, selectDashboardOpportunities, type DashboardIssue } from './dashboardOpportunities.ts'

const severity = { critical: 'Critical', medium: 'Medium', low: 'Low' } as const

/** Saved evidence only. Scores/comparisons are supplied by the backend, never inferred here. */
export function mapDashboardAssessment(businessId: string, dashboard: Dashboard | null, website: WebsiteReport | null, social: FacebookReportResponse | null) {
  const view = mapDashboardReports(dashboard, website, social)
  const issues: DashboardIssue[] = []
  for (const channel of [
    { results: website?.results, category: 'website' as const, source: 'Website', expected: 'website' },
    { results: social?.analysis ?? social?.report?.results, category: 'social' as const, source: 'Facebook', expected: 'facebook' },
  ]) {
    for (const finding of channel.results?.findings ?? []) {
      if (finding.source !== channel.expected) continue
      const recommendation = channel.results?.recommendations.find(item => item.findingId === finding.id)
      const summaries = channel.results && 'evidenceSummaries' in channel.results ? channel.results.evidenceSummaries : undefined
      const summary = summaries?.findings.find(item => item.id === finding.id)
      issues.push({ id: finding.id, title: finding.title, explanation: summary?.text ?? finding.explanation,
        severity: severity[finding.severity], status: finding.status, source: channel.source,
        category: channel.category, mode: 'saved', destination: opportunityDestination(channel.category, businessId),
        recommendation: recommendation ? { id: recommendation.id, title: recommendation.title,
          explanation: recommendation.recommendedChange || recommendation.explanation, status: recommendation.status } : undefined,
      })
    }
  }
  return { ...view, businessId, ...selectDashboardOpportunities(issues) }
}
