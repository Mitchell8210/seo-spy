import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapSocialMediaReport } from '../src/services/socialMediaMapping.ts'

function fixture() {
  const metric = (name, total) => ({ name, total, status: 'available', aggregation: 'sum', period: 'day',
    ...(name === 'page_post_likes' ? { sourceMetric: 'page_actions_post_reactions_total', breakdown: 'like' } : {}),
    points: [], coverage: { complete: true, expectedDays: 30, returnedDays: 30 } })
  return { report: { audit: { status: 'partial' }, results: { findings: [], recommendations: [], facebook: {
    pageName: 'Authorized Page', window: { requestedDays: 30, basis: 'complete-provider-days' }, profile: {},
    metrics: [metric('page_post_engagements', 5), metric('page_post_likes', 4), metric('page_media_view', 0),
      metric('page_messages_new_conversations_unique', 1), metric('page_total_actions', 10)],
  } } }, analysis: null }
}
const card = (view, id) => view.healthMetrics.find(item => item.id === id)
test('maps cumulative interactions and LIKE only; preserves zero without inventing contacts, messages or reach', () => {
  const view = mapSocialMediaReport(fixture())
  assert.equal(card(view, 'interactions').value, '5')
  assert.equal(card(view, 'interactions').supporting[0].value, '4')
  assert.deepEqual(card(view, 'interactions').supporting.slice(1).map(item => item.value), ['Not collected', 'Not collected', 'Not collected'])
  assert.equal(card(view, 'reach').value, 'Not available')
  assert.equal(card(view, 'reach').supporting[0].value, '0')
  assert.equal(card(view, 'contacts').value, 'Not available')
  assert.equal(view.periodLabel, 'Last 30 days')
})
test('rejects legacy, short-window, incomplete and snapshot metrics as cumulative totals', () => {
  for (const change of [
    f => { delete f.window.basis },
    f => { f.window.requestedDays = 7 },
    f => { f.metrics.forEach(m => { m.coverage.complete = false }) },
    f => { f.metrics.forEach(m => { m.coverage.returnedDays = 29 }) },
    f => { f.metrics.forEach(m => { m.aggregation = 'snapshot' }) },
  ]) {
    const data = fixture()
    change(data.report.results.facebook)
    const view = mapSocialMediaReport(data)
    assert.equal(card(view, 'interactions').value, 'Not available')
    assert.equal(card(view, 'interactions').supporting[0].value, 'Not available')
  }
})

test('maps lifetime shares as a separate temporary exception, and comments only for matching complete period evidence', () => {
  const data = fixture()
  const facebook = data.report.results.facebook
  Object.assign(facebook.window, { since: '2026-10-02T07:00:00Z', until: '2026-11-01T07:00:00Z', timeZone: 'America/Los_Angeles' })
  facebook.lifetimeShares = { basis: 'lifetime', sourceField: 'shares', knownTotal: 18, total: null, complete: false, postsCollected: 5, postsWithCounts: 2 }
  facebook.commentCounts = { basis: 'reporting-window', status: 'available', complete: true, total: 1,
    since: facebook.window.since, until: facebook.window.until, timeZone: facebook.window.timeZone }
  const rows = () => card(mapSocialMediaReport(data), 'interactions').supporting
  assert.equal(rows()[1].label, 'Comments')
  assert.equal(rows()[1].value, '1')
  assert.equal(rows()[2].label, 'Shares')
  assert.equal(rows()[2].value, '18+')
  Object.assign(facebook.lifetimeShares, { total: 18, complete: true, postsWithCounts: 5 })
  assert.equal(rows()[2].value, '18')
  facebook.commentCounts.until = '2026-11-02T07:00:00Z'
  assert.equal(rows()[1].value, 'Not available')
  Object.assign(facebook.lifetimeShares, { total: 0, knownTotal: 0 })
  assert.equal(rows()[2].value, '0')
  facebook.lifetimeShares.complete = false
  assert.equal(rows()[2].value, 'Not available')
})
