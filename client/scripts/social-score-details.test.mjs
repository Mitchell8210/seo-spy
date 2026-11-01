import assert from 'node:assert/strict'
import { test } from 'node:test'
import { socialScoreDetails } from '../src/services/socialScoreDetails.ts'
import { savedChannelScore } from '../src/services/savedScore.ts'
import { mapDashboardAssessment } from '../src/services/dashboardAssessment.ts'

const at = '2026-11-01T00:00:00.000Z'
function fixture() {
  const business = { id: 'business', name: 'Saved Business', website: 'https://example.com/' }
  const definitions = [['profile-quality', 'Profile Quality', 15], ['posting-consistency', 'Posting Consistency', 20], ['audience-engagement', 'Audience Engagement', 25], ['reach-growth', 'Audience Reach and Growth', 15], ['content-quality', 'Content Quality', 15], ['customer-interaction', 'Customer Interaction', 10]]
  const categories = definitions.map(([id, label, maximum]) => ({ id, label, maximum, earned: id === 'customer-interaction' ? null : maximum / 2,
    evidencedWeight: id === 'customer-interaction' ? 0 : maximum, applicableWeight: maximum, recommendations: ['Review the saved evidence and improve this category.'], criteria: [{
      id: `${id}-criterion`, label: `${label} check`, maximum, earned: id === 'customer-interaction' ? null : maximum / 2,
      status: id === 'customer-interaction' ? 'unavailable' : 'available', value: id === 'customer-interaction' ? null : 0, unit: 'observed units',
      explanation: id === 'customer-interaction' ? 'Response evidence is unavailable; new conversations do not establish response quality.' : 'Saved evidence supports this criterion.',
      evidence: id === 'customer-interaction' ? [] : [{ reportId: 'facebook', evidenceId: id }], recommendation: 'Review this criterion.',
    }] }))
  const socialAssessment = { version: 'social-performance-v1', policyHash: 'b'.repeat(64), businessId: business.id, pageId: '123', reportId: 'facebook', value: 50,
    exact: { numerator: '50', denominator: '1' }, status: 'definitive', coveragePercent: 90, knownWeight: 90, applicableWeight: 100, categories,
    missingMetrics: [{ id: 'response-quality', label: 'Response quality', reason: 'Appropriate response evidence is unavailable.' }], recommendations: [],
    limitations: ['Thresholds are provisional product benchmarks, not established industry standards.'], freshness: { collectedAt: at, cutoff: at, expiresAt: '2026-11-08T00:00:00.000Z', status: 'fresh' } }
  const metric = value => ({ value, maximum: 100, availability: 'available', reasons: [] })
  const assessment = { id: 'assessment', businessId: business.id, policyVersion: 'seo-spy-score-v1.4', policyHash: 'a'.repeat(64), profile: 'baseline-mobile-v1', cutoff: at, readAt: at,
    socialScope: 'facebook-presence-quality', socialAssessment, sources: [{ provider: 'website', reportId: 'website', businessId: business.id }, { provider: 'facebook', reportId: 'facebook', businessId: business.id }],
    scores: { website: metric(79), social: metric(50), consistency: metric(60), overall: metric(67) }, analysis: null }
  const social = { businessId: business.id, report: { auditId: 'facebook', business, results: { facebook: { pageId: '123', pageName: 'Saved Page', profile: {}, metrics: [], window: { requestedDays: 30 } },
    evidence: definitions.map(([id]) => ({ id })), findings: [], recommendations: [] } }, analysis: null }
  const website = { auditId: 'website', business, audit: { completedAt: at }, results: { findings: [], recommendations: [], evidence: [] } }
  return { business, assessment, social, website, dashboard: { business, assessment } }
}

test('maps the backend category breakdown and preserves verified zero observations', () => {
  const f = fixture(), before = JSON.stringify(f)
  const details = socialScoreDetails(f.assessment, f.business.id, f.social)
  assert.equal(details.value, 50)
  assert.equal(details.categories[1].criteria[0].value, 0)
  assert.equal(details.categories[5].earned, null)
  assert.equal(details.categories[5].evidencedWeight, 0)
  assert.equal(savedChannelScore(f.assessment, f.business.id, 'facebook', 'social'), 50)
  const view = mapDashboardAssessment(f.business.id, f.dashboard, f.website, f.social)
  assert.equal(view.socialAssessment, details)
  assert.equal(view.socialScore.value, 50)
  assert.equal(view.main.overall.value, 67)
  assert.equal(JSON.stringify(f), before)
})

test('keeps provisional values separate from the Social and Spy Total gauges', () => {
  const f = fixture()
  f.assessment.socialAssessment.status = 'provisional'
  f.assessment.socialAssessment.coveragePercent = 15
  f.assessment.socialAssessment.knownWeight = 15
  const view = mapDashboardAssessment(f.business.id, f.dashboard, f.website, f.social)
  assert.equal(view.socialAssessment.status, 'provisional')
  assert.equal(view.socialAssessment.value, 50)
  assert.equal(view.socialScore.value, null)
  assert.equal(view.main.overall.value, null)
  assert.equal(savedChannelScore(f.assessment, f.business.id, 'facebook', 'social'), null)
})

test('rejects mismatched ownership, citations, unsupported weights and false definitive status', () => {
  const changes = [
    f => { f.assessment.socialAssessment.businessId = 'other' },
    f => { f.assessment.socialAssessment.pageId = '456' },
    f => { f.assessment.socialAssessment.reportId = 'older' },
    f => { f.assessment.sources[1].reportId = 'older' },
    f => { f.assessment.socialAssessment.categories[0].criteria[0].evidence[0].evidenceId = 'unrelated' },
    f => { f.assessment.socialAssessment.categories[0].maximum = 100 },
    f => { f.assessment.socialAssessment.categories[0].earned = 16 },
    f => { f.assessment.socialAssessment.coveragePercent = 15 },
    f => { f.assessment.socialAssessment.categories[1].evidencedWeight = 0 },
    f => { f.assessment.socialAssessment.categories[1].evidencedWeight = 9; f.assessment.socialAssessment.categories[1].earned = 0 },
    f => { f.assessment.socialAssessment.categories[2].evidencedWeight = 14; f.assessment.socialAssessment.categories[2].earned = 0 },
    f => { f.assessment.socialAssessment.value = null },
    f => { f.assessment.socialAssessment.status = 'insufficient_data' },
    f => { f.assessment.socialAssessment.categories[0] = null },
    f => { f.assessment.socialAssessment.categories[0].criteria[0] = null },
    f => { f.assessment.socialAssessment.categories[0].criteria[0].evidence[0] = null },
  ]
  for (const change of changes) {
    const f = fixture(); change(f)
    assert.equal(socialScoreDetails(f.assessment, f.business.id, f.social), null)
    const view = mapDashboardAssessment(f.business.id, f.dashboard, f.website, f.social)
    assert.equal(view.socialScore.value, null)
    assert.equal(view.main.overall.value, null)
  }
})

test('suppresses stale scores while retaining explicitly dated historical observations', () => {
  const f = fixture(); f.assessment.readAt = '2026-11-09T00:00:00.000Z'
  const details = socialScoreDetails(f.assessment, f.business.id, f.social)
  assert.equal(details.status, 'insufficient_data')
  assert.equal(details.value, null)
  assert.equal(details.freshness.status, 'stale')
  assert.equal(details.categories[1].criteria[0].value, 0)
  assert.equal(savedChannelScore(f.assessment, f.business.id, 'facebook', 'social'), null)
  assert.equal(mapDashboardAssessment(f.business.id, f.dashboard, f.website, f.social).main.overall.value, null)
})

test('legacy assessments retain their existing presentation without a fabricated breakdown', () => {
  const f = fixture(); f.assessment.policyVersion = 'seo-spy-score-v1.3'; delete f.assessment.socialAssessment
  const view = mapDashboardAssessment(f.business.id, f.dashboard, f.website, f.social)
  assert.equal(view.socialAssessment, null)
  assert.equal(view.socialScore.value, 50)
})
