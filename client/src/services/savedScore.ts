import type { SavedAssessment } from '../types/assessment'

export function knownAssessment(assessment: SavedAssessment | null | undefined, businessId: string): assessment is SavedAssessment {
  return !!assessment && assessment.businessId === businessId && ['seo-spy-score-v1', 'seo-spy-score-v1.1', 'seo-spy-score-v1.2', 'seo-spy-score-v1.3', 'seo-spy-score-v1.4'].includes(assessment.policyVersion)
    && /^[a-f0-9]{64}$/.test(assessment.policyHash) && Array.isArray(assessment.sources) && assessment.scores !== null && typeof assessment.scores === 'object'
}

/** Only expose the backend score for the exact business and saved channel report. */
export function savedChannelScore(assessment: SavedAssessment | null | undefined, businessId: string, reportId: string, channel: 'website' | 'social'): number | null {
  if (!knownAssessment(assessment, businessId) || !assessment.sources.some(source => source.businessId === businessId && source.reportId === reportId && source.provider === (channel === 'website' ? 'website' : 'facebook'))) return null
  if (channel === 'social' && assessment.policyVersion === 'seo-spy-score-v1.4') {
    const details = assessment.socialAssessment
    if (!details || details.businessId !== businessId || details.reportId !== reportId || details.status !== 'definitive' || details.coveragePercent < 70 ||
      details.freshness.status !== 'fresh' || !Number.isFinite(Date.parse(details.freshness.expiresAt)) || Date.parse(assessment.readAt) > Date.parse(details.freshness.expiresAt)) return null
  }
  const score = assessment.scores[channel]
  return score?.availability === 'available' && score.maximum === 100 && typeof score.value === 'number' && Number.isInteger(score.value) && score.value >= 0 && score.value <= 100 ? score.value : null
}

export function scoreCaption(assessment: SavedAssessment | null | undefined, channel: 'website' | 'social') {
  if (!assessment) return 'Not available'
  const scope = channel === 'website' ? `${assessment.profile === 'baseline-desktop-v1' ? 'Desktop' : 'Mobile'} website health`
    : assessment.socialScope === 'facebook-presence-quality' ? 'Facebook presence quality'
      : assessment.socialScope === 'facebook-profile-readiness' ? 'Facebook profile readiness · Posting activity advisory' : 'Facebook profile and publishing'
  return `SEO Spy policy ${assessment.policyVersion.replace('seo-spy-score-', '')} · ${scope} · ${assessment.cutoff}`
}
