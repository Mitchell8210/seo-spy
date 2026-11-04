import type { SavedAssessment } from '../types/assessment'
import type { FacebookReportResponse } from '../types/facebook'
import type { WebsiteReport } from '../types/websiteApi'
import { opportunityDestination, type DashboardIssue } from './dashboardOpportunities.ts'

type Ref = { reportId: string; evidenceId: string }
const key = (ref: Ref) => JSON.stringify([ref.reportId, ref.evidenceId])
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum

/** Saved interpretation only. Scoring observations never become original audit findings. */
export function mapSavedMuseAssessment(assessment: SavedAssessment | null, website: WebsiteReport | null, social: FacebookReportResponse | null) {
  const analysis = assessment?.analysis
  if (!assessment || !analysis || !['assessment-muse-output-v3', 'assessment-muse-output-v4'].includes(analysis.output?.schemaVersion ?? '')
    || analysis.assessmentId !== assessment.id || analysis.businessId !== assessment.businessId
    || !(analysis.isMock === true && analysis.generationMode === 'mock' || analysis.isMock === false && ['poc', 'demo'].includes(analysis.generationMode))
    || (!analysis.isMock && (analysis.provider !== 'meta' || !analysis.usageAttemptId))
    || !Array.isArray(analysis.sourceManifest) || analysis.sourceManifest.length !== assessment.sources.length
    || !Array.isArray(analysis.output.recommendations)
    || assessment.reasons?.includes('STALE_INPUT')
    || !text(analysis.output.summary, 700) || !text(analysis.output.scoringExplanation?.text, 1400)) return null
  const currentReport = (provider: 'website' | 'facebook') => provider === 'website' ? website : social?.report
  const manifests = analysis.sourceManifest
  if (manifests.some(source => !source || !['website', 'facebook'].includes(source.provider) || !/^[a-f0-9]{64}$/.test(source.contentHash))
    || new Set(manifests.map(source => source.provider)).size !== manifests.length || manifests.some(source => {
    const pinned = assessment.sources.find(item => item.provider === source.provider)
    const current = currentReport(source.provider)
    return !pinned || pinned.businessId !== assessment.businessId || source.reportId !== pinned.reportId || source.contentHash !== pinned.reportHash
      || !current || current.auditId !== source.reportId || current.business.id !== assessment.businessId
  })) return null
  const resolves = (ref: Ref) => {
    const manifest = manifests.find(source => source.reportId === ref.reportId)
    if (!manifest) return false
    const report = currentReport(manifest.provider)
    if (!report?.results) return false
    if (report.results.evidence?.some(item => item.id === ref.evidenceId && item.auditId === ref.reportId && item.mode === 'live')) return true
    return manifest.provider === 'website' && !!website?.results?.lighthouse?.categories.some(item => item.availability === 'measured' && ref.evidenceId === `lighthouse-category:${item.id}`)
  }
  const validRefs = (refs: Ref[]) => Array.isArray(refs) && refs.length > 0 && refs.length <= 6
    && refs.every(ref => !!ref && text(ref.reportId, 160) && text(ref.evidenceId, 160))
    && new Set(refs.map(key)).size === refs.length && refs.every(resolves)
  const path: DashboardIssue[] = []
  for (const recommendation of analysis.output.recommendations ?? []) {
    if (!recommendation || !text(recommendation.id, 160) || path.some(item => item.recommendation?.id === recommendation.id)) continue
    const origin = recommendation.origin
    if (!origin || !['finding', 'scoring-observation'].includes(origin.kind) || !['website', 'social', 'consistency'].includes(origin.category)
      || !text(recommendation.title, 160) || !text(recommendation.recommendation, 700) || !validRefs(recommendation.evidenceRefs)
      || !manifests.some(source => source.reportId === recommendation.reportId)
      || !validRefs(origin.sourceRefs) || origin.sourceRefs.length !== recommendation.evidenceRefs.length
      || origin.sourceRefs.some(ref => !recommendation.evidenceRefs.some(item => key(item) === key(ref)))) continue
    const report = currentReport(origin.category === 'social' ? 'facebook' : 'website')
    let findingId: string | undefined
    if (origin.kind === 'finding') {
      if (origin.category === 'consistency' || recommendation.reportId !== report?.auditId) continue
      const finding = report?.results?.findings.find(item => item.id === recommendation.findingId)
      if (!finding || recommendation.evidenceRefs.some(ref => ref.reportId !== report?.auditId || !finding.evidenceIds.includes(ref.evidenceId))) continue
      findingId = finding.id
    } else if (origin.category === 'social') {
      if (recommendation.findingId !== 'score:social:posting') continue
      const posting = ['posts-per-week', 'posting-recency-days', 'active-week-ratio', 'longest-gap-days']
      const criteria = assessment.socialAssessment?.categories.flatMap(category => category.criteria)
        .filter(item => posting.includes(item.id))
        .filter(item => item.status === 'available' && item.earned !== null && item.earned < item.maximum) ?? []
      if (!criteria.length
        || recommendation.reportId !== social?.report?.auditId
        || recommendation.evidenceRefs.some(ref => !criteria.some(criterion => criterion.evidence.some(item => key(item) === key(ref))))) continue
    } else if (origin.category === 'consistency') {
      if (recommendation.findingId !== 'score:consistency:disagreements'
        || !assessment.comparisons?.some(item => ['business-name', 'hours'].includes(item.id) && item.applicable && item.outcome === 'fail')
        || !recommendation.evidenceRefs.some(ref => ref.reportId === website?.auditId)
        || !recommendation.evidenceRefs.some(ref => ref.reportId === social?.report?.auditId)) continue
    } else continue
    path.push({ id: `assessment:${analysis.id}:${recommendation.id}`, title: recommendation.title,
      explanation: recommendation.rationale ?? recommendation.recommendation, severity: 'Medium', status: 'needs_review',
      source: analysis.isMock ? 'Mock AI assessment' : 'Meta Muse-assisted assessment', category: origin.category, mode: 'saved',
      origin: 'assessment', findingId,
      fixReview: { id: recommendation.id, title: recommendation.title, category: origin.category,
        source: analysis.isMock ? 'Mock AI assessment' : 'Meta Muse-assisted assessment', isMock: analysis.isMock,
        explanation: recommendation.rationale ?? recommendation.recommendation, recommendation: recommendation.recommendation,
        businessId: assessment.businessId, assessmentId: assessment.id, analysisId: analysis.id,
        reportId: recommendation.reportId, findingId, evidenceRefs: recommendation.evidenceRefs,
        target: origin.category === 'social' ? social?.report?.results?.facebook?.pageName : origin.category === 'website' ? website?.business.website : undefined,
        risk: recommendation.risk, effort: recommendation.effort, verificationSteps: recommendation.verificationSteps,
        manualFallback: recommendation.manualFallback },
      destination: opportunityDestination(origin.category, assessment.businessId),
      recommendation: { id: recommendation.id, title: recommendation.title, explanation: recommendation.recommendation, status: 'needs_review' },
    })
  }
  return { id: analysis.id, label: analysis.isMock ? 'Mock AI assessment' : 'Meta Muse-assisted assessment', summary: analysis.output.summary,
    scoringExplanation: analysis.output.scoringExplanation!.text, path }
}
