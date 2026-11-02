/** A recommendation review, not an executable proposal or write authorization. */
export interface FixReviewRequest {
  id: string
  title: string
  category: 'website' | 'social' | 'consistency'
  source: string
  explanation: string
  recommendation?: string
  target?: string
  evidence?: string[]
  evidenceRefs?: { reportId: string; evidenceId: string }[]
  businessId?: string
  assessmentId?: string
  analysisId?: string
  reportId?: string
  findingId?: string
  risk?: string
  effort?: string
  verificationSteps?: string[]
  manualFallback?: string
  isMock?: boolean
}
