export interface AssessmentScore {
  value: number | null
  maximum: 100
  availability: 'available' | 'unavailable'
  reasons: string[]
}
export interface SavedAssessment {
  id: string
  businessId: string
  policyVersion: 'seo-spy-score-v1' | 'seo-spy-score-v1.1' | 'seo-spy-score-v1.2'
  policyHash: string
  profile: 'baseline-mobile-v1' | 'baseline-desktop-v1'
  cutoff: string
  socialScope?: 'facebook-profile-readiness'
  consistencyBasis?: 'preferred-values' | 'source-agreement'
  reportingCutoff?: string | null
  readAt: string
  sources: { reportId: string; reportHash: string; businessId: string; provider: 'website' | 'facebook'; collectedAt: string }[]
  scores: Record<'website' | 'social' | 'consistency' | 'overall', AssessmentScore>
  reasons: string[]
  limitations: string[]
  comparisons?: { id: string; outcome: 'pass' | 'fail' | 'unknown'; applicable: boolean; website: string | null; facebook: string | null }[]
  analysis: {
    id: string; assessmentId: string; businessId: string; isMock: boolean; generationMode: 'mock' | 'poc' | 'demo'
    output: { recommendations: { id: string; reportId: string; findingId: string; title: string; recommendation: string; evidenceRefs: { reportId: string; evidenceId: string }[] }[] }
  } | null
}
