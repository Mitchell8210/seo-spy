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
