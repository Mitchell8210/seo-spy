import type { FacebookFinding, FacebookReportResponse } from '../types/facebook'
import type { Evidence } from '../types/backend'
import type { SocialCategory, SocialFinding, SocialHealthMetric } from '../types/socialMedia'

const formatNumber = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : 'Not available'
const severity = { critical: 'Critical', medium: 'Medium', low: 'Low' } as const

function category(finding: FacebookFinding): SocialCategory {
  if (/phone|hours|website|email|location/.test(finding.checkId)) return 'Business Information'
  if (/posting|posts|activity/.test(finding.checkId)) return 'Content'
  if (/engagement|interactions/.test(finding.checkId)) return 'Engagement'
  if (/follow|growth/.test(finding.checkId)) return 'Growth'
  return 'Profile'
}

function evidenceText(items: Evidence[]) {
  if (!items.length) return 'Supporting evidence was not included in this saved report.'
  const text = items.map(item => `${item.checkId} · Collected ${item.collectedAt}\n${Object.entries(item.observed).map(([key, value]) => `${key}: ${value}`).join('\n')}`).join('\n\n')
  return text.length > 6000 ? `${text.slice(0, 6000)}\n… Full collected evidence is available in the report download.` : text
}

export function mapSocialMediaReport(data: FacebookReportResponse) {
  const { report, analysis } = data
  if (!report) return null
  const facebook = report.results.facebook
  const sources = analysis?.findings ?? report.results.findings
  const recommendations = analysis?.recommendations ?? report.results.recommendations
  const hasUrgentFindings = sources.some(finding => finding.severity === 'critical')
  const partial = report.audit.status === 'partial'
  const scoreSummary = hasUrgentFindings
    ? 'Your social media has important issues that need attention.'
    : partial
      ? sources.length > 0
        ? 'A few things need attention on your social media account.'
        : 'Your social media review is ready, but some information is missing.'
      : sources.length > 0
        ? 'Your social media is in good shape, but a few things need attention.'
        : 'No issues were found in the social media checks we completed.'
  const value = (name: string) => {
    const metric = facebook.metrics.find(item => item.name === name)
    return metric?.status === 'available' ? formatNumber(metric.total) : 'Not available'
  }
  const profileFollowers = facebook.profile.followers_count
  const followers = profileFollowers?.status === 'available' && typeof profileFollowers.value === 'number' ? formatNumber(profileFollowers.value) : 'Not available'
  const supporting = (id: string, label: string, content: string) => ({ id, label, value: content, direction: 'neutral' as const })
  const healthMetrics: SocialHealthMetric[] = [
    { id: 'followers', title: 'Followers', value: followers, supporting: [supporting('followed', 'Daily new followers', value('page_daily_follows_unique')), supporting('unfollowed', 'Daily unfollows', value('page_daily_unfollows_unique')), supporting('change', 'Net change', formatNumber(facebook.summary.followersChange))] },
    { id: 'reach', title: 'Media views', value: value('page_media_view'), supporting: [supporting('page-views', 'Page views', value('page_views_total')), supporting('video-views', 'Video views', value('page_video_views'))] },
    { id: 'contacts', title: 'Customer contacts', value: 'Not available', supporting: [supporting('messages', 'Messages', 'Not collected'), supporting('calls', 'Calls', 'Not collected')] },
    { id: 'interactions', title: 'Post engagements', value: value('page_post_engagements'), supporting: [supporting('likes', 'Post likes', 'Not collected'), supporting('comments', 'Comments', 'Not collected'), supporting('shares', 'Shares', 'Not collected')] },
  ]
  const findings: SocialFinding[] = sources.map(finding => {
    const recommendation = recommendations.find(item => item.findingId === finding.id)
    return { id: finding.id, title: finding.title, category: category(finding), severity: severity[finding.severity], status: 'Needs review', explanation: finding.explanation,
      evidence: evidenceText(report.results.evidence.filter(item => finding.evidenceIds.includes(item.id))), impact: recommendation?.purpose ?? 'Review the collected evidence before deciding whether a change is appropriate.', affectedArea: facebook.pageName,
      recommendation: { id: recommendation?.id ?? `${finding.id}-review`, action: recommendation?.recommendedChange ?? 'Review this finding and the saved evidence before making changes.' } }
  })
  return { facebook, healthMetrics, findings, scoreSummary, summaries: analysis?.summaries ?? [], periodLabel: `${facebook.window.requestedDays}-day requested window`, evidenceLabel: `Saved Facebook evidence · Collected ${facebook.collectedAt}` }
}
