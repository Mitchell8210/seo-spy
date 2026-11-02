import type { Dashboard } from '../types/backend'
import type { FacebookReportResponse } from '../types/facebook'
import type { WebsiteReport } from '../types/websiteApi'
import { mapDashboardReports } from './dashboardMapping.ts'
import { opportunityDestination, selectDashboardOpportunities, type DashboardIssue } from './dashboardOpportunities.ts'
import { knownAssessment } from './savedScore.ts'
import { socialScoreDetails } from './socialScoreDetails.ts'
import { mapSavedMuseAssessment } from './dashboardMuse.ts'

const severity = { critical: 'Critical', medium: 'Medium', low: 'Low' } as const

/** Saved evidence only. Scores/comparisons are supplied by the backend, never inferred here. */
export function mapDashboardAssessment(businessId: string, dashboard: Dashboard | null, website: WebsiteReport | null, social: FacebookReportResponse | null) {
  const view = mapDashboardReports(dashboard, website, social)
  const assessment = dashboard?.assessment
  const knownPolicy = knownAssessment(assessment, businessId)
  const websiteMatch = knownPolicy && !!website && assessment.sources.some(source => source.provider === 'website' && source.businessId === businessId && source.reportId === website.auditId)
  const socialMatch = knownPolicy && !!social?.report && assessment.sources.some(source => source.provider === 'facebook' && source.businessId === businessId && source.reportId === social.report!.auditId)
  const socialAssessment = socialMatch ? socialScoreDetails(assessment, businessId, social) : null
  const scoreValue = (category: 'website' | 'social' | 'consistency' | 'overall', matches: boolean) => {
    const score = knownPolicy ? assessment.scores[category] : null
    if (knownPolicy && assessment.policyVersion === 'seo-spy-score-v1.4' && ['social', 'overall'].includes(category) && socialAssessment?.status !== 'definitive') return null
    return matches && score?.availability === 'available' && score.maximum === 100 && typeof score.value === 'number' && Number.isInteger(score.value) && score.value >= 0 && score.value <= 100 ? score.value : null
  }
  const websiteScore = { ...view.websiteResults.overall, value: scoreValue('website', !!websiteMatch) }
  const socialScore = { id: 'social-score', label: 'Social Media Score', maximum: 100, description: 'Facebook profile and publishing against the confirmed goal.', value: scoreValue('social', !!socialMatch) }
  const consistencyScore = { ...view.consistency.score, value: scoreValue('consistency', !!websiteMatch && !!socialMatch) }
  const overallScore = { ...view.main.overall, value: scoreValue('overall', !!websiteMatch && !!socialMatch) }
  const criterionIds: Record<string, string> = { name: 'business-name', phone: 'phone', url: 'website-url', hours: 'hours' }
  const comparisons = websiteMatch && socialMatch && Array.isArray(assessment?.comparisons) ? assessment.comparisons : []
  const checks = view.consistency.checks.map(check => {
    const comparison = comparisons.find(item => item.id === criterionIds[check.id])
    return comparison ? { ...check, matches: comparison.outcome === 'unknown' || !comparison.applicable ? null : comparison.outcome === 'pass',
      website: comparison.website ?? 'Not available', social: comparison.facebook ?? 'Not available' } : check
  })
  const savedAnalysis = knownPolicy ? assessment.analysis : null
  const analysis = savedAnalysis?.assessmentId === assessment?.id && savedAnalysis?.businessId === businessId
    && Array.isArray(savedAnalysis.output?.recommendations)
    && (savedAnalysis.isMock === true && savedAnalysis.generationMode === 'mock' || savedAnalysis.isMock === false && ['poc', 'demo'].includes(savedAnalysis.generationMode)) ? savedAnalysis : null
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
      const muse = analysis?.output.recommendations.find(item => item.findingId === finding.id && item.reportId === (channel.category === 'website' ? website?.auditId : social?.report?.auditId)
        && Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0 && item.evidenceRefs.every(ref => ref.reportId === item.reportId && finding.evidenceIds.includes(ref.evidenceId)))
      issues.push({ id: finding.id, title: finding.title, explanation: summary?.text ?? finding.explanation,
        severity: severity[finding.severity], status: finding.status, source: channel.source,
        category: channel.category, mode: 'saved', destination: opportunityDestination(channel.category, businessId),
        recommendation: muse ? { id: muse.id, title: muse.title, explanation: `${analysis?.isMock ? 'Mock AI recommendation' : 'Saved AI recommendation'}: ${muse.recommendation}`, status: 'needs_review' } : recommendation ? { id: recommendation.id, title: recommendation.title,
          explanation: recommendation.recommendedChange || recommendation.explanation, status: recommendation.status } : undefined,
      })
    }
  }
  const opportunities = selectDashboardOpportunities(issues)
  const interpretation = mapSavedMuseAssessment(knownPolicy ? assessment : null, website, social)
  // Use the validated selection for the existing category cards, including
  // scoring observations that have no original audit finding. Keep model order
  // and leave omitted categories empty instead of inventing an AI priority.
  const top = interpretation ? Object.fromEntries((['website', 'social', 'consistency'] as const).map(category => [category,
    interpretation.path.filter(item => item.category === category).slice(0, 3).map(item => ({ ...item,
      explanation: `${item.source}: ${item.recommendation!.explanation}`,
    })),
  ])) as Record<DashboardIssue['category'], DashboardIssue[]> : opportunities.top
  return { ...view, businessId, scoreAssessment: knownPolicy ? assessment : null, socialScore, socialAssessment, interpretation,
    websiteResults: { ...view.websiteResults, overall: websiteScore }, consistency: { ...view.consistency, score: consistencyScore, checks },
    main: { ...view.main, overall: overallScore, components: [websiteScore, socialScore, consistencyScore] },
    ...opportunities, top, path: interpretation ? interpretation.path : opportunities.path }
}
