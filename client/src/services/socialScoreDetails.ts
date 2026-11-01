import type { SavedAssessment } from '../types/assessment'
import type { FacebookReportResponse } from '../types/facebook'
import type { SocialPerformanceAssessment } from '../types/socialAssessment'

const categoryWeights = { 'profile-quality': 15, 'posting-consistency': 20, 'audience-engagement': 25, 'reach-growth': 15, 'content-quality': 15, 'customer-interaction': 10 } as const
const finite = (value: unknown, minimum = 0, maximum = 100): value is number => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4000
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

/** Validate a saved backend breakdown; this mapper never assigns points or fills missing metrics. */
export function socialScoreDetails(assessment: SavedAssessment | null | undefined, businessId: string, social: FacebookReportResponse | null): SocialPerformanceAssessment | null {
  const result = assessment?.socialAssessment, report = social?.report
  if (assessment?.policyVersion !== 'seo-spy-score-v1.4' || assessment.businessId !== businessId || !report || social?.businessId !== businessId || report.business.id !== businessId ||
    !result || result.version !== 'social-performance-v1' || result.businessId !== businessId || result.reportId !== report.auditId || result.pageId !== report.results.facebook.pageId ||
    !assessment.sources.some(source => source.provider === 'facebook' && source.businessId === businessId && source.reportId === result.reportId) ||
    !/^[a-f0-9]{64}$/.test(result.policyHash) || !['definitive', 'provisional', 'insufficient_data'].includes(result.status) ||
    !finite(result.coveragePercent) || !finite(result.knownWeight) || !finite(result.applicableWeight) || result.knownWeight > result.applicableWeight ||
    result.value !== null && !finite(result.value) || result.status === 'insufficient_data' && result.value !== null || result.status !== 'insufficient_data' && result.value === null ||
    !result.freshness || !date(result.freshness.collectedAt) || !date(result.freshness.cutoff) || !date(result.freshness.expiresAt) || !['fresh', 'stale'].includes(result.freshness.status) ||
    !Array.isArray(result.categories) || result.categories.length !== 6 || result.categories.some(item => !item || typeof item !== 'object') || new Set(result.categories.map(item => item.id)).size !== 6 ||
    !Array.isArray(result.missingMetrics) || result.missingMetrics.some(item => !item || !text(item.id) || !text(item.label) || !text(item.reason)) ||
    !Array.isArray(result.limitations) || result.limitations.some(item => !text(item)) || !Array.isArray(result.recommendations) || result.recommendations.some(item => !text(item))) return null
  const evidence = new Set(report.results.evidence.map(item => item.id))
  for (const category of result.categories) {
    if (!Object.hasOwn(categoryWeights, category.id) || category.maximum !== categoryWeights[category.id] || !text(category.label) ||
      !finite(category.evidencedWeight, 0, category.maximum) || !finite(category.applicableWeight, 0, category.maximum) || category.evidencedWeight > category.applicableWeight ||
      category.earned !== null && !finite(category.earned, 0, category.evidencedWeight) || !Array.isArray(category.criteria) ||
      !Array.isArray(category.recommendations) || category.recommendations.some(item => !text(item))) return null
    for (const criterion of category.criteria) {
      if (!criterion || !text(criterion.id) || !text(criterion.label) || !finite(criterion.maximum, 0, category.maximum) || !['available', 'unavailable', 'not_applicable'].includes(criterion.status) ||
        criterion.earned !== null && !finite(criterion.earned, 0, criterion.maximum) || !text(criterion.explanation) || typeof criterion.unit !== 'string' ||
        criterion.value !== null && (typeof criterion.value !== 'number' || !Number.isFinite(criterion.value)) || typeof criterion.recommendation !== 'string' ||
        !Array.isArray(criterion.evidence) || criterion.evidence.some(ref => !ref || ref.reportId !== report.auditId || !evidence.has(ref.evidenceId)) ||
        criterion.status === 'available' && (criterion.earned === null || criterion.evidence.length === 0) || criterion.status !== 'available' && criterion.earned !== null) return null
    }
  }
  if (result.status === 'definitive' && (result.coveragePercent < 70 || !result.categories.some(item => item.id === 'posting-consistency' && item.evidencedWeight >= 10) ||
    !result.categories.some(item => item.id === 'audience-engagement' && item.evidencedWeight >= 15))) return null
  // Saved read models normally provide this overlay. Preserve their known observations, but never expose an expired numeric score.
  if (result.freshness.status === 'stale' || assessment.scores.social.reasons.includes('STALE_INPUT') || date(assessment.readAt) && Date.parse(assessment.readAt) > Date.parse(result.freshness.expiresAt)) {
    return { ...result, status: 'insufficient_data', value: null, freshness: { ...result.freshness, status: 'stale' } }
  }
  return result
}
