export interface InvestigationInterpretation {
  schemaVersion: 'investigation-interpretation-v1'
  id: string; businessId: string; createdAt: string; status: 'pending' | 'completed' | 'failed'; errorCode: string | null
  model: string; attemptId: string | null; summary: string | null
  sources: { reportId: string; hash: string; provider: 'website' | 'facebook' }[]
  recommendations: { id: string; category: 'website' | 'social' | 'consistency'; reportId: string; findingId: string | null
    title: string; recommendation: string; rationale: string; verification: string; evidenceRefs: { reportId: string; evidenceId: string }[] }[]
}
