import { mockBusiness } from '../data/mockBusiness'
import { mockFindings } from '../data/mockFindings'
import { mockRecommendations } from '../data/mockRecommendations'
import { mockConsistency } from '../data/mockResults'
import { mapSocialMediaReport } from '../services/socialMediaMapping'
import { opportunityDestination, selectDashboardOpportunities, type DashboardIssue } from '../services/dashboardOpportunities'
import { useFacebookReport } from './useFacebookReport'

export function useDashboardAssessment() {
  const social = useFacebookReport(mockBusiness.id)
  const socialView = social.data ? mapSocialMediaReport(social.data) : null
  const website: DashboardIssue[] = mockFindings.filter(finding => finding.source === 'Website').map(finding => ({
    ...finding, category: 'website', mode: 'demo', destination: opportunityDestination('website', mockBusiness.id),
    recommendation: mockRecommendations.find(item => item.findingId === finding.id),
  }))
  const consistency: DashboardIssue[] = mockConsistency.checks.filter(check => !check.matches).map(check => ({
    id: check.id, title: check.label, severity: 'Medium', status: 'Needs review', source: 'Website + Facebook',
    explanation: `Website: ${check.website}. Facebook: ${check.social}.`, category: 'consistency', mode: 'demo',
    destination: opportunityDestination('consistency', mockBusiness.id),
  }))
  const rawFindings = social.data?.analysis?.findings ?? social.data?.report?.results.findings ?? []
  const recommendations = social.data?.analysis?.recommendations ?? social.data?.report?.results.recommendations ?? []
  const saved: DashboardIssue[] = (socialView?.findings ?? []).map<DashboardIssue>(finding => {
    const raw = rawFindings.find(item => item.id === finding.id)
    const recommendation = recommendations.find(item => item.findingId === finding.id)
    return { ...finding, status: raw?.status ?? finding.status, source: 'Facebook', category: 'social', mode: 'saved',
      destination: opportunityDestination('social', mockBusiness.id),
      recommendation: recommendation ? { id: recommendation.id, title: recommendation.title, explanation: recommendation.recommendedChange || recommendation.explanation, status: recommendation.status } : undefined }
  })
  return { social, socialView, ...selectDashboardOpportunities([...website, ...saved, ...consistency]) }
}
export type DashboardAssessmentModel = ReturnType<typeof useDashboardAssessment>
