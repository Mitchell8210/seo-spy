import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatedReportRecommendations, interpretationIssues } from '../src/services/reportInterpretation.ts'
import { mapWebsiteReport } from '../src/services/websiteMapping.ts'

const businessId = 'fixture-business', reportId = '00000000-0000-4000-8000-000000000001'
const source = () => ({ auditId: reportId, business: { id: businessId, website: 'https://example.com/' }, generatedAt: '2026-11-03T00:00:00Z',
  audit: { id: reportId, businessId, scope: 'lighthouse', mode: 'live', status: 'completed', completedAt: '2026-11-03T00:00:00Z' },
  results: { evidence: [{ id: 'evidence', sourceUrl: 'https://example.com/', checkId: 'page-title' }], findings: [{ id: 'finding', checkId: 'page-title', source: 'website', evidenceIds: ['evidence'], title: 'Original title finding', explanation: 'Original measured explanation', severity: 'medium' }],
    recommendations: [{ id: 'coded', findingId: 'finding', recommendedChange: 'Original coded action' }], scores: [] } })
const interpretation = () => ({ schemaVersion: 'investigation-interpretation-v1', id: 'ai', businessId, status: 'completed', attemptId: 'accounted-attempt',
  sources: [{ reportId, provider: 'website', hash: 'hash' }], recommendations: [{ id: 'new-ai-action', category: 'website', reportId, findingId: 'finding', title: 'A clear generated recommendation',
    recommendation: 'Use the actual service and owner-confirmed location in the title.', rationale: 'The supplied title is too broad for the business context.', verification: 'Verify the title in the next saved report.', evidenceRefs: [{ reportId, evidenceId: 'evidence' }] }] })

test('grounded model actions populate existing recommendation slots without changing findings or scores', () => {
  const report = source(), original = structuredClone(report), ai = interpretation()
  const view = mapWebsiteReport(report, null, ai)
  assert.equal(view.recommendations[0].id, 'coded')
  assert.equal(view.recommendations[0].action, `AI recommendation: ${ai.recommendations[0].recommendation}`)
  assert.equal(view.findings[0].title, 'Original title finding')
  assert.equal(view.results.overall.value, null)
  assert.deepEqual(report, original)
  const issue = interpretationIssues(ai, businessId, [report])[0]
  assert.equal(issue.source, 'Meta Muse-assisted report')
  assert.deepEqual(issue.fixReview.verificationSteps, [ai.recommendations[0].verification])
})
test('new model recommendations can be shown as suggestions without fabricating original findings or execution targets', () => {
  const ai = interpretation(); ai.recommendations[0].findingId = null
  const issue = interpretationIssues(ai, businessId, [source()])[0]
  assert.equal(issue.fixReview.findingId, undefined)
  assert.equal(issue.fixReview.target, undefined)
  assert.equal(issue.status, 'needs_review')
  assert.equal(mapWebsiteReport(source(), null, ai).recommendations[0].action, 'Original coded action')
})

test('a linked action may include additional saved context but must retain its finding citation', () => {
  const report = source(), ai = interpretation()
  report.results.evidence.push({ id: 'context', sourceUrl: 'https://example.com/', checkId: 'page-context' })
  ai.recommendations[0].evidenceRefs.push({ reportId, evidenceId: 'context' })
  assert.equal(validatedReportRecommendations(ai, businessId, [report]).length, 1)
  ai.recommendations[0].evidenceRefs = [{ reportId, evidenceId: 'context' }]
  assert.equal(validatedReportRecommendations(ai, businessId, [report]).length, 0)
})
test('failed, pending, mismatched and uncited interpretations cannot replace measured report recommendations', () => {
  for (const mutate of [
    ai => { ai.status = 'failed' }, ai => { ai.status = 'pending' }, ai => { ai.businessId = 'another' }, ai => { ai.attemptId = null },
    ai => { ai.recommendations[0].evidenceRefs[0].evidenceId = 'invented' }, ai => { ai.recommendations[0].findingId = 'invented' },
    ai => { ai.recommendations[0].category = 'social' }, ai => { ai.recommendations[0].evidenceRefs[0].reportId = 'old' },
  ]) {
    const ai = interpretation(); mutate(ai)
    assert.deepEqual(validatedReportRecommendations(ai, businessId, [source()]), [])
    assert.equal(mapWebsiteReport(source(), null, ai).recommendations[0].action, 'Original coded action')
  }
})
