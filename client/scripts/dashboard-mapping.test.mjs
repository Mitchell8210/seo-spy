import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapDashboardReports } from '../src/services/dashboardMapping.ts'

function fixture() {
  const business = { id: 'business', name: 'Real Business', website: 'https://example.com/' }
  const finding = (id, source, severity) => ({ id, source, severity, auditId: source, title: id, explanation: `${id} explanation`, evidenceIds: [], checkId: 'page-title' })
  const recommendation = (id, findingId) => ({ id, findingId, title: id, recommendedChange: `${id} suggested action` })
  const website = { auditId: 'website', business, audit: { completedAt: '2026-10-30T10:00:00Z' }, results: {
    findings: [finding('website-low', 'website', 'low'), finding('website-critical', 'website', 'critical')],
    recommendations: [recommendation('website-action', 'website-critical'), recommendation('unmatched', 'absent')], evidence: [],
    lighthouse: { categories: [{ id: 'performance', score: 0, availability: 'measured', auditIds: ['pass'] }],
      checks: [{ id: 'pass', scoreDisplayMode: 'binary', score: 1 }] },
  } }
  const report = { business, results: { facebook: { pageId: '123', pageName: 'Real Page', profile: { followers_count: { status: 'available', value: 0 } }, window: { requestedDays: 30 },
    metrics: [{ name: 'page_post_engagements', aggregation: 'sum', status: 'available', total: 0 }, { name: 'page_media_view', status: 'available', total: 500 }] }, findings: [], recommendations: [] } }
  const social = { report, analysis: { findings: [finding('facebook-medium', 'facebook', 'medium')], recommendations: [recommendation('facebook-action', 'facebook-medium')] } }
  return { business, website, social }
}

test('uses real channel values, keeps zero, and never substitutes views or invents scores', () => {
  const { business, website, social } = fixture()
  const view = mapDashboardReports({ business }, website, social)
  assert.equal(view.business.name, 'Real Business')
  assert.equal(view.websiteResults.categories[0].value, 0)
  assert.equal(view.websiteResults.categories[1].value, null)
  assert.equal(view.websiteResults.checksPassed, 1)
  assert.deepEqual(view.socialResults.metrics.map(item => item.value), ['0', '—', '—', '0'])
  assert.ok(view.socialResults.secondary.every(item => item.value === '—'))
  assert.equal(view.main.overall.value, null)
  assert.ok(view.main.components.every(item => item.value === null))
  assert.equal(view.consistency.score.value, null)
  assert.ok(view.consistency.checks.every(item => item.matches === null))
  assert.ok(view.connections.every(item => item.status === 'Connected'))
})

test('merges channels by backend severity and preserves recommendation references without mutating evidence', () => {
  const { website, social } = fixture()
  const original = structuredClone({ website, social })
  const view = mapDashboardReports(null, website, social)
  assert.deepEqual(view.findings.map(item => item.id), ['website-critical', 'facebook-medium', 'website-low'])
  assert.deepEqual(view.recommendations.map(item => item.findingId), ['website-critical', 'facebook-medium'])
  assert.deepEqual(view.findings.map(item => item.source), ['Website', 'Facebook', 'Website'])
  assert.equal(view.recommendations[0].explanation, 'website-action suggested action')
  assert.equal(view.main.priorityOpportunities, 2)
  assert.deepEqual({ website, social }, original)
})

test('missing reports stay unavailable rather than becoming a clean or successful audit', () => {
  const view = mapDashboardReports(null, null, null)
  assert.equal(view.business, null)
  assert.equal(view.websiteResults.issues, null)
  assert.equal(view.websiteResults.checksPassed, null)
  assert.ok(view.websiteResults.categories.every(item => item.value === null))
  assert.equal(view.main.priorityOpportunities, null)
  assert.equal(view.connections.length, 0)
  assert.equal(view.topFindings.length, 0)
})

test('does not put a different time window or unavailable Facebook metric under a 30-day label', () => {
  const { social } = fixture()
  social.report.results.facebook.window.requestedDays = 7
  social.report.results.facebook.metrics[0].total = 21
  assert.equal(mapDashboardReports(null, null, social).socialResults.metrics[3].value, '—')
  social.report.results.facebook.window.requestedDays = 30
  social.report.results.facebook.metrics[0].status = 'unavailable'
  assert.equal(mapDashboardReports(null, null, social).socialResults.metrics[3].value, '—')
})
