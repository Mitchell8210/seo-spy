import type { FacebookFinding, FacebookReportResponse } from '../types/facebook'
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
    return facebook.window.requestedDays === 30 && facebook.window.basis === 'complete-provider-days' &&
      (name !== 'page_post_likes' || (metric?.sourceMetric === 'page_actions_post_reactions_total' && metric.breakdown === 'like')) &&
      metric?.status === 'available' && metric.aggregation === 'sum' && metric.coverage?.complete === true &&
      metric.coverage.expectedDays === 30 && metric.coverage.returnedDays === 30
      ? formatNumber(metric.total) : 'Not available'
  }
  const profileFollowers = facebook.profile.followers_count
  const shares = facebook.lifetimeShares
  const shareValue = shares?.basis === 'lifetime' && shares.sourceField === 'shares'
    ? shares.complete && shares.total !== null ? formatNumber(shares.total)
      : Number.isSafeInteger(shares.knownTotal) && shares.knownTotal > 0 ? `${formatNumber(shares.knownTotal)}+` : 'Not available'
    : 'Not collected'
  const comments = facebook.commentCounts
  const commentValue = comments ? comments.basis === 'reporting-window' && comments.status === 'available' && comments.complete &&
    facebook.window.requestedDays === 30 && facebook.window.basis === 'complete-provider-days' &&
    comments.since === facebook.window.since && comments.until === facebook.window.until && comments.timeZone === facebook.window.timeZone
    ? formatNumber(comments.total) : 'Not available' : 'Not collected'
  const followers = profileFollowers?.status === 'available' && typeof profileFollowers.value === 'number' ? formatNumber(profileFollowers.value) : 'Not available'
  const supporting = (id: string, label: string, content: string): SocialHealthMetric['supporting'][number] => ({
    id, label, value: content,
    direction: content === 'Not available' || content === 'Not collected' ? 'neutral' : id === 'unfollowed' ? 'down' : 'up',
  })
  const healthMetrics: SocialHealthMetric[] = [
    { id: 'followers', title: 'Followers', value: followers, supporting: [supporting('new-followers', 'New Followers', value('page_daily_follows_unique')), supporting('unfollowed', 'Unfollowed', value('page_daily_unfollows_unique'))] },
    { id: 'reach', title: 'People Reached', value: 'Not available', supporting: [supporting('media-views', 'Media views', value('page_media_view')), supporting('page-views', 'Page views', value('page_views_total')), supporting('video-views', 'Video views', value('page_video_views'))] },
    { id: 'contacts', title: 'People Who Contacted You', value: 'Not available', supporting: [supporting('website-clicks', 'Website Clicks', 'Not collected'), supporting('address-clicks', 'Address Clicks', 'Not collected'), supporting('mentions', 'People Mentioning Your Business', 'Not collected')] },
    { id: 'interactions', title: 'Interactions', value: value('page_post_engagements'), supporting: [supporting('likes', 'Likes', value('page_post_likes')), supporting('comments', 'Comments', commentValue), supporting('shares', 'Shares', shareValue), supporting('messages', 'Messages', 'Not collected')] },
  ]
  const findings: SocialFinding[] = sources.map(finding => {
    const recommendation = recommendations.find(item => item.findingId === finding.id)
    return { id: finding.id, title: finding.title, category: category(finding), severity: severity[finding.severity], status: 'Needs review', explanation: finding.explanation,
      evidence: analysis?.evidenceSummaries?.findings.find(item => item.id === finding.id)?.text ?? 'Supporting evidence was not included in this saved report.', impact: recommendation?.purpose ?? 'Review the collected evidence before deciding whether a change is appropriate.', affectedArea: facebook.pageName,
      recommendation: { id: recommendation?.id ?? `${finding.id}-review`, action: recommendation?.recommendedChange ?? 'Review this finding and the saved evidence before making changes.' } }
  })
  return { facebook, healthMetrics, findings, scoreSummary, summaries: analysis?.summaries ?? [], periodLabel: `Last ${facebook.window.requestedDays} days`, evidenceLabel: `Saved Facebook evidence · Collected ${facebook.collectedAt}` }
}
