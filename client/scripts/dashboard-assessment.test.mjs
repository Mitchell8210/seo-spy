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

function museFixture() {
  const fixture = scoredFixture()
  const { business, dashboard, website, social } = fixture
  const assessment = dashboard.assessment
  assessment.reasons = []
  const ref = (reportId, evidenceId) => ({ reportId, evidenceId })
  const web = ref('website', 'web-proof'), posting = ref('facebook', 'posting-proof')
  website.results.evidence = [{ id: 'web-proof', auditId: 'website', mode: 'live' }]
  website.results.findings[0].evidenceIds = ['web-proof']
  social.report.results.evidence = [{ id: 'posting-proof', auditId: 'facebook', mode: 'live' }]
  for (const [index, source] of assessment.sources.entries()) source.reportHash = (index === 0 ? 'a' : 'b').repeat(64)
  assessment.comparisons = [{ id: 'business-name', outcome: 'fail', applicable: true, website: 'Website name', facebook: 'Page name' }, { id: 'hours', outcome: 'fail', applicable: true, website: 'Restricted hours', facebook: 'Always open' }]
  assessment.socialAssessment = { categories: [{ criteria: [{ id: 'posts-per-week', status: 'available', earned: 0, maximum: 6, evidence: [posting] }] }] }
  const recommendation = (id, findingId, category, kind, evidenceRefs) => ({ id, findingId, reportId: evidenceRefs[0].reportId,
    title: id, recommendation: `${id} complete recommendation.`, rationale: 'Confirmed saved evidence requires review.',
    evidenceRefs, origin: { kind, category, sourceRefs: evidenceRefs } })
  assessment.analysis = { id: 'v3-analysis', assessmentId: assessment.id, businessId: business.id, isMock: true, generationMode: 'mock',
    sourceManifest: assessment.sources.map(source => ({ reportId: source.reportId, contentHash: source.reportHash, provider: source.provider })),
    output: { schemaVersion: 'assessment-muse-output-v3', summary: 'Main mobile content took 11.6 seconds. Review posting activity and inconsistent business details.',
      scoringExplanation: { text: 'Social 71 has 71% evidence coverage; only 17 followers make action ratios volatile.', categories: ['website', 'social', 'consistency', 'overall'] },
      recommendations: [recommendation('Improve mobile loading', 'one', 'website', 'finding', [web]), recommendation('Resume useful posting', 'score:social:posting', 'social', 'scoring-observation', [posting]), recommendation('Confirm business details', 'score:consistency:disagreements', 'consistency', 'scoring-observation', [web, posting])] } }
  return fixture
}

test('shows the v3 consultation and prioritized scoring recommendations in existing slots without inventing audit findings', () => {
  const { business, dashboard, website, social } = museFixture()
  const before = JSON.stringify({ dashboard, website, social })
  const view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.equal(view.interpretation.label, 'Mock AI assessment')
  assert.match(view.interpretation.summary, /11\.6 seconds/)
  assert.match(view.interpretation.scoringExplanation, /17 followers/)
  assert.deepEqual(view.path.map(item => item.recommendation.title), ['Improve mobile loading', 'Resume useful posting', 'Confirm business details'])
  assert.ok(view.path.every(item => item.origin === 'assessment' && item.source === 'Mock AI assessment'))
  assert.equal(view.path[0].findingId, 'one', 'Only actual report findings carry a finding navigation target.')
  assert.equal(view.path[1].findingId, undefined)
  assert.equal(view.path[1].destination, '/social-media?businessId=business')
  assert.equal(view.path[2].findingId, undefined)
  assert.equal(view.path[2].destination, '/dashboard#consistency-details')
  assert.deepEqual(view.top.website.map(item => item.title), ['Improve mobile loading'])
  assert.deepEqual(view.top.social.map(item => item.title), ['Resume useful posting'])
  assert.deepEqual(view.top.consistency.map(item => item.title), ['Confirm business details'])
  assert.match(view.top.social[0].explanation, /^Mock AI assessment: Resume useful posting/)
  assert.ok(!view.remaining.some(item => item.id.startsWith('assessment:')))
  assert.equal(view.websiteResults.overall.value, 79)
  assert.equal(JSON.stringify({ dashboard, website, social }), before)
})

test('fails closed for v3 interpretation with stale, mismatched, unknown or cross-business provenance', () => {
  for (const mutate of [
    assessment => { assessment.businessId = 'other' },
    assessment => { assessment.reasons = ['STALE_INPUT'] },
    assessment => { assessment.analysis.sourceManifest[0].contentHash = 'c'.repeat(64) },
    assessment => { assessment.analysis.sourceManifest[1].reportId = 'older-facebook' },
    assessment => { assessment.analysis.output.schemaVersion = 'assessment-muse-output-v9' },
    assessment => { assessment.analysis.output.summary = '' },
  ]) {
    const { business, dashboard, website, social } = museFixture()
    mutate(dashboard.assessment)
    assert.equal(mapDashboardAssessment(business.id, dashboard, website, social).interpretation, null)
  }
})

test('labels saved Meta selections as assisted output without changing mock slots or inventing findings', () => {
  const fixture = museFixture(), analysis = fixture.dashboard.assessment.analysis
  analysis.isMock = false; analysis.generationMode = 'poc'; analysis.provider = 'meta'; analysis.usageAttemptId = 'offline-ledger-attempt'
  const view = mapDashboardAssessment(fixture.business.id, fixture.dashboard, fixture.website, fixture.social)
  assert.equal(view.interpretation.label, 'Meta Muse-assisted assessment')
  assert.equal(view.path.length, 3)
  assert.ok(view.path.every(item => item.source === 'Meta Muse-assisted assessment' && item.origin === 'assessment'))
  assert.equal(view.path[1].findingId, undefined)
  delete analysis.usageAttemptId
  assert.equal(mapDashboardAssessment(fixture.business.id, fixture.dashboard, fixture.website, fixture.social).interpretation, null)
})

test('does not accept arbitrary scoring IDs, unrelated citations, passed comparisons or unsupported origin metadata', () => {
  for (const mutate of [
    fixture => { fixture.dashboard.assessment.analysis.output.recommendations[1].findingId = 'score:social:invented' },
    fixture => { fixture.dashboard.assessment.analysis.output.recommendations[1].evidenceRefs = [{ reportId: 'facebook', evidenceId: 'unknown' }] },
    fixture => { fixture.dashboard.assessment.socialAssessment.categories[0].criteria[0].earned = 6 },
    fixture => { fixture.dashboard.assessment.analysis.output.recommendations[1].origin.category = 'website' },
    fixture => { fixture.dashboard.assessment.analysis.output.recommendations[1].origin.sourceRefs = [] },
    fixture => { fixture.dashboard.assessment.analysis.output.recommendations[1].evidenceRefs = [null] },
  ]) {
    const fixture = museFixture()
    mutate(fixture)
    const view = mapDashboardAssessment(fixture.business.id, fixture.dashboard, fixture.website, fixture.social)
    assert.ok(!view.path.some(item => item.recommendation.title === 'Resume useful posting'))
  }
  const fixture = museFixture()
  fixture.dashboard.assessment.comparisons.forEach(item => { item.outcome = 'pass' })
  const view = mapDashboardAssessment(fixture.business.id, fixture.dashboard, fixture.website, fixture.social)
  assert.ok(!view.path.some(item => item.recommendation.title === 'Confirm business details'))
})


test('maps v4 selected order and preserves an explicit empty selection in existing Dashboard slots', () => {
  for (const count of [0, 1, 2, 3]) {
    const { business, dashboard, website, social } = museFixture()
    const analysis = dashboard.assessment.analysis
    analysis.output.schemaVersion = 'assessment-muse-output-v4'
    analysis.output.recommendations = [...analysis.output.recommendations].reverse().slice(0, count)
    analysis.output.summary = count ? 'Selected saved priorities in the returned order.' : 'No improvement opportunities were selected from verified saved evidence.'
    const view = mapDashboardAssessment(business.id, dashboard, website, social)
    assert.ok(view.interpretation)
    assert.equal(view.path.length, count, 'An empty v4 selection must not fall back to unrelated recommendations.')
    assert.deepEqual(view.path.map(item => item.recommendation.id), analysis.output.recommendations.map(item => item.id))
    for (const category of ['website', 'social', 'consistency']) {
      assert.deepEqual(view.top[category].map(item => item.recommendation.id), analysis.output.recommendations
        .filter(item => item.origin.category === category).map(item => item.id))
    }
    assert.equal(view.websiteResults.overall.value, 79)
  }
})

test('places the live v4 loading and posting selections in the main category cards with complete preview text', () => {
  const { business, dashboard, website, social } = museFixture()
  const analysis = dashboard.assessment.analysis
  Object.assign(analysis, { isMock: false, generationMode: 'poc', provider: 'meta', usageAttemptId: 'saved-live-attempt' })
  analysis.output.schemaVersion = 'assessment-muse-output-v4'
  analysis.output.recommendations = analysis.output.recommendations.slice(0, 2)
  const view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.equal(view.top.website[0].title, 'Improve mobile loading')
  assert.equal(view.top.website[0].findingId, 'one')
  assert.equal(view.top.social[0].title, 'Resume useful posting')
  assert.equal(view.top.social[0].findingId, undefined)
  assert.equal(view.top.social[0].recommendation.explanation, analysis.output.recommendations[1].recommendation)
  assert.match(view.top.social[0].explanation, /^Meta Muse-assisted assessment:/)
  assert.deepEqual(view.top.consistency, [], 'An omitted review is not presented as a selected AI priority.')
  assert.equal(view.consistency.checks.find(item => item.id === 'name').matches, false)
  dashboard.assessment.reasons = ['STALE_INPUT']
  const stale = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.equal(stale.interpretation, null)
  assert.ok([...stale.top.website, ...stale.top.social].every(item => item.origin !== 'assessment'))
})

test('keeps selected order within a category instead of sorting recommendations by original finding severity', () => {
  const { business, dashboard, website, social } = museFixture()
  const analysis = dashboard.assessment.analysis
  analysis.output.schemaVersion = 'assessment-muse-output-v4'
  website.results.findings[1].evidenceIds = ['web-proof']
  const first = { ...analysis.output.recommendations[0], id: 'second-finding-first', findingId: 'two', title: 'Review the second finding first' }
  analysis.output.recommendations = [first, analysis.output.recommendations[0]]
  const view = mapDashboardAssessment(business.id, dashboard, website, social)
  assert.deepEqual(view.top.website.map(item => item.findingId), ['two', 'one'])
  assert.deepEqual(view.top.website.map(item => item.recommendation.id), ['second-finding-first', 'Improve mobile loading'])
})
