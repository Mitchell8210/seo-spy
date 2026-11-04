import type { FacebookFinding, FacebookReportResponse } from '../types/facebook'
import type { SocialCategory, SocialFinding, SocialHealthMetric } from '../types/socialMedia'
import type { InvestigationInterpretation } from '../types/investigationInterpretation'
import { validatedReportRecommendations } from './reportInterpretation.ts'

const formatNumber = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : 'Not available'
const severity = { critical: 'Critical', medium: 'Medium', low: 'Low' } as const

function category(finding: FacebookFinding): SocialCategory {
  if (/phone|hours|website|email|location/.test(finding.checkId)) return 'Business Information'
  if (/posting|posts|activity/.test(finding.checkId)) return 'Content'
  if (/engagement|interactions/.test(finding.checkId)) return 'Engagement'
  if (/follow|growth/.test(finding.checkId)) return 'Growth'
  return 'Profile'
}

export function mapSocialMediaReport(data: FacebookReportResponse, interpretation?: InvestigationInterpretation | null) {
  const { report, analysis } = data
  if (!report) return null
  const facebook = report.results.facebook
  const sources = analysis?.findings ?? report.results.findings
  const recommendations = analysis?.recommendations ?? report.results.recommendations
  const ai = validatedReportRecommendations(interpretation, data.businessId, [report])
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
  const metricTotal = (name: string): number | null => {
    const metric = facebook.metrics.find(item => item.name === name)
    return facebook.window.requestedDays === 30 && facebook.window.basis === 'complete-provider-days' &&
      (name !== 'page_post_likes' || (metric?.sourceMetric === 'page_actions_post_reactions_total' && metric.breakdown === 'like')) &&
      metric?.status === 'available' && metric.aggregation === 'sum' && metric.coverage?.complete === true &&
      metric.coverage.expectedDays === 30 && metric.coverage.returnedDays === 30 &&
      typeof metric.total === 'number' && Number.isSafeInteger(metric.total) && metric.total >= 0
      ? metric.total : null
  }
  const value = (name: string) => formatNumber(metricTotal(name))
  const sum = (values: (number | null)[]) => {
    if (values.some(item => item === null)) return 'Not available'
    const total = values.reduce<number>((total, item) => total + item!, 0)
    return Number.isSafeInteger(total) ? formatNumber(total) : 'Not available'
  }
  const profileFollowers = facebook.profile.followers_count
  const visits = data.websiteVisits
  const websiteVisitTotal = visits?.businessId === data.businessId && report.business.id === data.businessId &&
    visits.provider === 'ga4' && visits.metric === 'sessions' && visits.attribution === 'facebook-session-source-v1' &&
    visits.status === 'available' && facebook.window.requestedDays === 30 && facebook.window.basis === 'complete-provider-days' &&
    typeof visits.total === 'number' && Number.isSafeInteger(visits.total) && visits.total >= 0 &&
    visits.since === facebook.window.since && visits.until === facebook.window.until && visits.timeZone === facebook.window.timeZone
    ? visits.total : null
  const websiteVisitValue = formatNumber(websiteVisitTotal)
  const shares = facebook.lifetimeShares
  const shareValue = shares?.basis === 'lifetime' && shares.sourceField === 'shares'
    ? shares.complete && shares.total !== null ? formatNumber(shares.total)
      : Number.isSafeInteger(shares.knownTotal) && shares.knownTotal > 0 ? `${formatNumber(shares.knownTotal)}+` : 'Not available'
    : 'Not collected'
  const comments = facebook.commentCounts
  const commentTotal = comments?.basis === 'reporting-window' && comments.status === 'available' && comments.complete &&
    facebook.window.requestedDays === 30 && facebook.window.basis === 'complete-provider-days' &&
    comments.since === facebook.window.since && comments.until === facebook.window.until && comments.timeZone === facebook.window.timeZone &&
    typeof comments.total === 'number' && Number.isSafeInteger(comments.total) && comments.total >= 0 ? comments.total : null
  const commentValue = comments ? formatNumber(commentTotal) : 'Not collected'
  const viewActivityTotal = sum([...['page_media_view', 'page_views_total', 'page_video_views'].map(metricTotal), websiteVisitTotal])
  const interactionTotal = sum([metricTotal('page_post_likes'), commentTotal, metricTotal('page_messages_new_conversations_unique')])
  const followers = profileFollowers?.status === 'available' && typeof profileFollowers.value === 'number' ? formatNumber(profileFollowers.value) : 'Not available'
  const supporting = (id: string, label: string, content: string): SocialHealthMetric['supporting'][number] => ({
    id, label, value: content,
    direction: content === 'Not available' || content === 'Not collected' ? 'neutral' : id === 'unfollowed' ? 'down' : 'up',
  })
  const healthMetrics: SocialHealthMetric[] = [
    { id: 'followers', title: 'Followers', value: followers, supporting: [supporting('new-followers', 'New Followers', value('page_daily_follows_unique')), supporting('unfollowed', 'Unfollowed', value('page_daily_unfollows_unique'))] },
    { id: 'reach', title: 'View Activity', value: viewActivityTotal, supporting: [supporting('media-views', 'Media views', value('page_media_view')), supporting('page-views', 'Page views', value('page_views_total')), supporting('video-views', 'Video views', value('page_video_views')), supporting('website-clicks', 'Website Visits', websiteVisitValue)] },
    { id: 'interactions', title: 'Interactions', value: interactionTotal, supporting: [supporting('likes', 'Likes', value('page_post_likes')), supporting('comments', 'Comments', commentValue), supporting('messages', 'Conversations', value('page_messages_new_conversations_unique')), supporting('shares', 'Lifetime Shares', shareValue)] },
  ]
  const findings: SocialFinding[] = sources.map(finding => {
    const original = recommendations.find(item => item.findingId === finding.id)
    const generated = ai.find(item => item.findingId === finding.id)
    const recommendation = generated ? { ...original, id: generated.id, purpose: generated.rationale, recommendedChange: `AI recommendation: ${generated.recommendation}` } : original
    return { id: finding.id, title: finding.title, category: category(finding), severity: severity[finding.severity], status: 'Needs review', explanation: finding.explanation,
      evidence: analysis?.evidenceSummaries?.findings.find(item => item.id === finding.id)?.text ?? 'Supporting evidence was not included in this saved report.', impact: recommendation?.purpose ?? 'Review the collected evidence before deciding whether a change is appropriate.', affectedArea: facebook.pageName,
      recommendation: { id: recommendation?.id ?? `${finding.id}-review`, action: recommendation?.recommendedChange ?? 'Review this finding and the saved evidence before making changes.' } }
  })
  return { facebook, healthMetrics, findings, scoreSummary, summaries: analysis?.summaries ?? [], periodLabel: `Last ${facebook.window.requestedDays} days`, evidenceLabel: `Saved Facebook evidence · Collected ${facebook.collectedAt}` }
}
