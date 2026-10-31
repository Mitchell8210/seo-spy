import type { Dashboard } from '../types/backend'
import type { FacebookReportResponse } from '../types/facebook'
import type { SocialResults } from '../types/dashboard'
import type { DashboardConnection, DashboardConsistency, DashboardFinding, DashboardMainScore, DashboardRecommendation, DashboardWebsiteResults } from '../types/dashboardLive'
import type { WebsiteScore } from '../types/website'
import type { WebsiteReport } from '../types/websiteApi'
import { mapWebsiteReport } from './websiteMapping.ts'

const unavailable = 'Not available'
const score = (id: string, label: string): WebsiteScore => ({ id, label, value: null, maximum: 100, description: label })
const severity = { critical: 'Critical', medium: 'Medium', low: 'Low' } as const
const priority = { Critical: 0, Medium: 1, Low: 2, Passed: 3, Verified: 4 }
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? new Intl.NumberFormat('en-US').format(value) : '—'

/** Adapts saved channel reports into existing Dashboard fields. No scoring or comparison rules. */
export function mapDashboardReports(dashboard: Dashboard | null, website: WebsiteReport | null, social: FacebookReportResponse | null) {
  const facebook = social?.report?.results.facebook
  const business = dashboard?.business ?? website?.business ?? social?.report?.business ?? null
  const websiteResults: DashboardWebsiteResults = website ? mapWebsiteReport(website).results : {
    overall: score('website-score', 'SEO Spy Website Score'),
    categories: [score('performance', 'Performance'), score('accessibility', 'Accessibility'), score('best-practices', 'Best Practices'), score('seo', 'SEO')],
    issues: null, checksPassed: null,
  }
  const findings: DashboardFinding[] = []
  const recommendations: DashboardRecommendation[] = []
  const channels = [
    { results: website?.results, source: 'Website' as const },
    { results: social?.analysis ?? social?.report?.results, source: 'Facebook' as const },
  ]
  for (const { results, source } of channels) {
    if (!results) continue
    for (const item of results.findings) {
      if (source === 'Website' && item.source !== 'website') continue
      if (source === 'Facebook' && item.source !== 'facebook') continue
      const finding: DashboardFinding = { id: item.id, severity: severity[item.severity], source, title: item.title, explanation: item.explanation, status: 'Needs review' }
      findings.push(finding)
      for (const recommendation of results.recommendations.filter(entry => entry.findingId === item.id)) {
        recommendations.push({ id: recommendation.id, findingId: item.id, title: recommendation.title,
          explanation: recommendation.recommendedChange, severity: finding.severity, source, status: 'Needs review' })
      }
    }
  }
  findings.sort((a, b) => priority[a.severity] - priority[b.severity])
  recommendations.sort((a, b) => priority[a.severity] - priority[b.severity])
  const followers = facebook?.profile.followers_count
  const interactions = facebook?.metrics.find(item => item.name === 'page_post_engagements')
  const socialResults: SocialResults = {
    account: facebook ? `Facebook · ${facebook.pageName}` : unavailable,
    metrics: [
      { id: 'followers', label: 'Followers', value: followers?.status === 'available' ? number(followers.value) : '—' },
      { id: 'reach', label: 'Reach — 30 days', value: '—' },
      { id: 'engagement', label: 'Engagement Rate', value: '—' },
      { id: 'interactions', label: 'Interactions — 30 days', value: facebook?.window.requestedDays === 30 && interactions?.status === 'available' && interactions.aggregation === 'sum' ? number(interactions.total) : '—' },
    ],
    secondary: ['Likes', 'Comments', 'Shares'].map(label => ({ label, value: '—' })),
  }
  const consistency: DashboardConsistency = {
    score: score('consistency', 'Business Consistency Score'), channels: 'Website ↔ Facebook',
    checks: [ ['hours', 'Business hours'], ['phone', 'Phone'], ['name', 'Business name'], ['url', 'Website URL'] ].map(([id, label]) => ({ id, label, matches: null, website: unavailable, social: unavailable })),
  }
  const main: DashboardMainScore = {
    overall: score('main-spy', 'Main Spy Score'), components: [score('website-score', 'Website'), score('social-score', 'Social Media'), score('consistency', 'Business Consistency')],
    priorityOpportunities: website || facebook ? findings.filter(item => item.severity === 'Critical' || item.severity === 'Medium').length : null,
  }
  const connections: DashboardConnection[] = [
    ...(business && (website || dashboard?.connections.some(item => item.platform === 'website' && item.mode === 'live' && item.status === 'connected')) ? [{ id: `website:${business.id}`, name: 'Website', platform: 'website' as const, identity: new URL(business.website).hostname, status: 'Connected' as const }] : []),
    ...(facebook ? [{ id: `facebook:${facebook.pageId}`, name: 'Facebook Business Page', platform: 'facebook' as const, identity: facebook.pageName, status: 'Connected' as const }] : []),
  ]
  return { business, websiteResults, socialResults, consistency, main, connections, findings, recommendations,
    topFindings: findings.slice(0, 3), topRecommendations: recommendations.slice(0, 3) }
}
