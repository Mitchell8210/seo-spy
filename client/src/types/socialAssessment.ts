export interface SocialScoreCriterion {
  id: string
  label: string
  maximum: number
  earned: number | null
  status: 'available' | 'unavailable' | 'not_applicable'
  value: number | null
  unit: string
  explanation: string
  reason?: string
  evidence: { reportId: string; evidenceId: string }[]
  recommendation: string
}

export interface SocialScoreCategory {
  id: 'profile-quality' | 'posting-consistency' | 'audience-engagement' | 'reach-growth' | 'content-quality' | 'customer-interaction'
  label: string
  maximum: number
  earned: number | null
  evidencedWeight: number
  applicableWeight: number
  criteria: SocialScoreCriterion[]
  recommendations: string[]
}

export interface SocialPerformanceAssessment {
  version: 'social-performance-v1'
  policyHash: string
  businessId: string
  pageId: string
  reportId: string
  value: number | null
  exact: { numerator: string; denominator: string } | null
  status: 'definitive' | 'provisional' | 'insufficient_data'
  coveragePercent: number
  knownWeight: number
  applicableWeight: number
  categories: SocialScoreCategory[]
  missingMetrics: { id: string; label: string; reason: string }[]
  recommendations: string[]
  limitations: string[]
  freshness: { collectedAt: string; cutoff: string; expiresAt: string; status: 'fresh' | 'stale' }
}
