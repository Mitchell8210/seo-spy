import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapDashboardAssessment } from '../src/services/dashboardAssessment.ts'

function fixture() {
  const business = { id: 'business', name: 'Saved Business', website: 'https://example.com/' }
  const finding = (id, source, severity = 'medium', status = 'needs_review') => ({ id, auditId: source, source, severity, status, title: id, explanation: 'Raw evidence', evidenceIds: [], checkId: 'page-title' })
  const recommendations = ['one', 'two', 'three', 'four'].map(id => ({ id: `${id}-action`, findingId: id, title: `${id} action`, recommendedChange: `${id} recorded change`, status: 'needs_review' }))
  const website = { business, auditId: 'website', audit: { completedAt: '2026-10-30T10:00:00Z' }, results: {
    findings: [finding('one', 'website', 'critical'), finding('two', 'website'), finding('three', 'website'), finding('four', 'website', 'low'), finding('done', 'website', 'critical', 'verified')],
    recommendations, evidence: [], evidenceSummaries: { findings: [{ id: 'four', text: 'Backend summary exactly.' }] },
  } }
  const social = { report: { business, results: { facebook: { pageId: '123', pageName: 'Saved Page', profile: {}, metrics: [], window: { requestedDays: 30 } }, findings: [], recommendations: [] } },
    analysis: { findings: [finding('facebook-one', 'facebook'), finding('wrong-channel', 'website')], recommendations: [{ id: 'social-action', findingId: 'facebook-one', title: 'Saved social action', recommendedChange: 'Review saved profile.', status: 'needs_review' }] } }
  return { business, website, social }
}

test('maps saved Website and Facebook evidence into the existing top/remaining/path slots', () => {
  const { business, website, social } = fixture()
  const before = JSON.stringify({ website, social })
  const view = mapDashboardAssessment(business.id, { business }, website, social)
  assert.equal(view.business.name, 'Saved Business')
  assert.deepEqual(view.top.website.map(item => item.id), ['one', 'two', 'three'])
  assert.deepEqual(view.top.social.map(item => item.id), ['facebook-one'])
  assert.equal(view.top.website[0].destination, '/website?businessId=business')
  assert.equal(view.top.social[0].destination, '/social-media?businessId=business')
  assert.deepEqual(view.top.consistency, [])
  assert.deepEqual(view.remaining.map(item => item.id), ['four'])
  assert.equal(view.remaining[0].explanation, 'Backend summary exactly.')
  assert.equal(view.path[0].recommendation.explanation, 'four recorded change')
  assert.ok([...view.top.website, ...view.top.social, ...view.remaining].every(item => item.mode === 'saved'))
  assert.equal(JSON.stringify({ website, social }), before)
})

test('does not substitute Lighthouse, traffic or mock data for unimplemented scores and comparisons', () => {
  const { business, website, social } = fixture()
  const view = mapDashboardAssessment(business.id, { business }, website, social)
  assert.equal(view.main.overall.value, null)
  assert.equal(view.websiteResults.overall.value, null)
  assert.equal(view.consistency.score.value, null)
  assert.equal(view.consistency.checks.length, 4)
  assert.ok(view.consistency.checks.every(item => item.matches === null && item.website === 'Not available' && item.social === 'Not available'))
  assert.equal(mapDashboardAssessment('business', null, null, null).remaining.length, 0)
  assert.equal(mapDashboardAssessment('business', null, null, null).business, null)
})

test('excludes resolved opportunities and recommendations without inventing replacement actions', () => {
  const { business, website, social } = fixture()
  website.results.recommendations.find(item => item.findingId === 'four').status = 'resolved'
  let view = mapDashboardAssessment(business.id, { business }, website, social)
  assert.deepEqual(view.path, [])
  website.results.recommendations = []
  view = mapDashboardAssessment(business.id, { business }, website, social)
  assert.deepEqual(view.path, [])
  assert.equal(view.remaining.length, 1)
})

function scoredFixture() {
  const source = fixture()
  source.social.report.auditId = 'facebook'
  const metric = value => ({ value, maximum: 100, availability: value === null ? 'unavailable' : 'available', reasons: [] })
  const assessment = { id: 'assessment', businessId: source.business.id, policyVersion: 'seo-spy-score-v1', policyHash: 'a'.repeat(64), profile: 'baseline-mobile-v1', cutoff: '2026-10-30T10:00:00Z',
    sources: [{ provider: 'website', reportId: 'website', businessId: source.business.id }, { provider: 'facebook', reportId: 'facebook', businessId: source.business.id }],
    scores: { website: metric(79), social: metric(null), consistency: metric(null), overall: metric(null) }, analysis: null }
  return { ...source, dashboard: { business: source.business, assessment } }
}

test('fills existing gauges only with eligible backend policy scores for the displayed reports', () => {
  const { business, dashboard, website, social } = scoredFixture()
  let view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.equal(view.websiteResults.overall.value, 79)
  assert.equal(view.main.components[0].value, 79)
  assert.equal(view.main.overall.value, null)
  assert.equal(view.socialScore.value, null)
  dashboard.assessment.scores.website.value = 0
  view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.equal(view.websiteResults.overall.value, 0, 'Measured zero remains a score.')
  dashboard.assessment.scores.website.availability = 'unavailable'
  assert.equal(mapDashboardAssessment(business.id, dashboard, website, social).websiteResults.overall.value, null)
})

test('never uses another business, report or unsupported policy to populate a gauge', () => {
  for (const change of [assessment => { assessment.businessId = 'other' }, assessment => { assessment.sources[0].reportId = 'older' }, assessment => { assessment.policyVersion = 'unknown' }]) {
    const { business, dashboard, website, social } = scoredFixture()
    change(dashboard.assessment)
    assert.equal(mapDashboardAssessment(business.id, dashboard, website, social).websiteResults.overall.value, null)
  }
})

test('uses cited mock recommendations with an explicit mock label and leaves deterministic scores alone', () => {
  const { business, dashboard, website, social } = scoredFixture()
  website.results.findings[0].evidenceIds = ['evidence']
  dashboard.assessment.analysis = { id: 'analysis', assessmentId: 'assessment', businessId: business.id, isMock: true, generationMode: 'mock', output: { recommendations: [{ id: 'mock-one', reportId: 'website', findingId: 'one', title: 'Context review', recommendation: 'Inspect the saved context first.', evidenceRefs: [{ reportId: 'website', evidenceId: 'evidence' }] }] } }
  let view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.match(view.top.website[0].recommendation.explanation, /^Mock AI recommendation:/)
  assert.equal(view.websiteResults.overall.value, 79)
  dashboard.assessment.analysis.output.recommendations[0].evidenceRefs[0].evidenceId = 'unrelated'
  view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.equal(view.top.website[0].recommendation.id, 'one-action', 'Unresolved model citations fall back to the recorded recommendation.')
})


test('maps all approved v1.2 scores and source disagreements to existing slots', () => {
  const { business, dashboard, website, social } = scoredFixture()
  const assessment = dashboard.assessment
  assessment.policyVersion = 'seo-spy-score-v1.2'
  assessment.socialScope = 'facebook-profile-readiness'
  assessment.consistencyBasis = 'source-agreement'
  for (const [key, value] of Object.entries({ website: 78, social: 100, consistency: 60, overall: 81 })) assessment.scores[key] = { value, maximum: 100, availability: 'available', reasons: [] }
  assessment.comparisons = [{ id: 'business-name', outcome: 'fail', applicable: true, website: 'Multi Services', facebook: 'Associates' }, { id: 'hours', outcome: 'fail', applicable: true, website: 'Mon?Sat 09:00?18:00; Sun Unknown', facebook: 'Always open (operator reviewed)' }]
  const view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.deepEqual(view.main.components.map(item => item.value), [78, 100, 60])
  assert.equal(view.main.overall.value, 81)
  assert.equal(view.consistency.checks.find(item => item.id === 'hours').matches, false)
  assert.equal(view.consistency.checks.find(item => item.id === 'name').website, 'Multi Services')
  assert.equal(view.scoreAssessment.consistencyBasis, 'source-agreement')
})
