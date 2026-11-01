import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapSocialMediaReport } from '../src/services/socialMediaMapping.ts'

function fixture() {
  const metric = (name, total) => ({ name, total, status: 'available', aggregation: 'sum', period: 'day',
    ...(name === 'page_post_likes' ? { sourceMetric: 'page_actions_post_reactions_total', breakdown: 'like' } : {}),
    points: [], coverage: { complete: true, expectedDays: 30, returnedDays: 30 } })
  return { businessId: 'business', report: { business: { id: 'business' }, audit: { status: 'partial' }, results: { findings: [], recommendations: [], facebook: {
    pageName: 'Authorized Page', window: { requestedDays: 30, basis: 'complete-provider-days', since: '2026-10-02T07:00:00Z', until: '2026-11-01T07:00:00Z', timeZone: 'America/Los_Angeles' }, profile: {},
    commentCounts: { basis: 'reporting-window', status: 'available', complete: true, total: 1,
      since: '2026-10-02T07:00:00Z', until: '2026-11-01T07:00:00Z', timeZone: 'America/Los_Angeles' },
    metrics: [metric('page_post_engagements', 5), metric('page_post_likes', 4), metric('page_media_view', 0),
      metric('page_messages_new_conversations_unique', 1), metric('page_total_actions', 10)],
    // Components remain separate measured counts; the view sum is a custom activity total.
  } } }, analysis: null }
}
const card = (view, id) => view.healthMetrics.find(item => item.id === id)
test('maps 30-day interactions from likes/comments/conversations, preserving measured zero and unknown data', () => {
  const view = mapSocialMediaReport(fixture())
  assert.equal(card(view, 'interactions').value, '6')
  assert.equal(card(view, 'interactions').supporting[0].value, '4')
  assert.deepEqual(card(view, 'interactions').supporting.slice(1).map(item => item.value), ['1', '1', 'Not collected'])
  assert.equal(card(view, 'interactions').supporting[2].label, 'Conversations')
  assert.equal(card(view, 'reach').value, 'Not available')
  assert.equal(card(view, 'reach').supporting[0].value, '0')
  assert.equal(card(view, 'contacts'), undefined)
  assert.deepEqual(view.healthMetrics.map(item => item.id), ['followers', 'reach', 'interactions'])
  assert.equal(view.periodLabel, 'Last 30 days')
})

test('maps Google-attributed website visits only for the matching business, metric and exact reporting window', () => {
  const data = fixture()
  const window = data.report.results.facebook.window
  Object.assign(window, { since: '2026-10-02T07:00:00Z', until: '2026-11-01T07:00:00Z', timeZone: 'America/Los_Angeles' })
  data.websiteVisits = { businessId: 'business', provider: 'ga4', metric: 'sessions', attribution: 'facebook-session-source-v1',
    since: window.since, until: window.until, timeZone: window.timeZone, status: 'available', total: 3 }
  const row = () => card(mapSocialMediaReport(data), 'reach').supporting[3]
  assert.equal(row().label, 'Website Visits')
  assert.equal(row().value, '3')
  data.websiteVisits.total = 0
  assert.equal(row().value, '0')
  for (const patch of [
    { status: 'unavailable' }, { businessId: 'another-business' }, { since: '2026-10-01T07:00:00Z' },
    { metric: 'clicks' }, { timeZone: 'UTC' }, { total: -1 }, { total: null },
  ]) {
    const original = { ...data.websiteVisits }
    Object.assign(data.websiteVisits, patch)
    assert.equal(row().value, 'Not available')
    data.websiteVisits = original
  }
  assert.equal(card(mapSocialMediaReport(data), 'contacts'), undefined)
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
    assert.equal(card(view, 'interactions').supporting[2].value, 'Not available')
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
  assert.equal(rows()[3].label, 'Lifetime Shares')
  assert.equal(rows()[3].value, '18+')
  assert.equal(card(mapSocialMediaReport(data), 'interactions').value, '6')
  Object.assign(facebook.lifetimeShares, { total: 18, complete: true, postsWithCounts: 5 })
  assert.equal(rows()[3].value, '18')
  facebook.commentCounts.until = '2026-11-02T07:00:00Z'
  assert.equal(rows()[1].value, 'Not available')
  Object.assign(facebook.lifetimeShares, { total: 0, knownTotal: 0 })
  assert.equal(rows()[3].value, '0')
  facebook.lifetimeShares.complete = false
  assert.equal(rows()[3].value, 'Not available')
})

test('sums view activity without calling it impressions and requires every component of each rollup', () => {
  const data = fixture()
  const facebook = data.report.results.facebook
  const metric = name => facebook.metrics.find(item => item.name === name)
  const complete = { complete: true, expectedDays: 30, returnedDays: 30 }
  facebook.metrics.push(...['page_views_total', 'page_video_views'].map((name, index) => ({ name, total: index === 0 ? 36 : 12,
    status: 'available', aggregation: 'sum', coverage: complete })))
  metric('page_media_view').total = 115
  data.websiteVisits = { businessId: 'business', provider: 'ga4', metric: 'sessions', attribution: 'facebook-session-source-v1',
    since: facebook.window.since, until: facebook.window.until, timeZone: facebook.window.timeZone, status: 'available', total: 3 }
  assert.equal(card(mapSocialMediaReport(data), 'reach').title, 'View Activity')
  assert.equal(card(mapSocialMediaReport(data), 'reach').value, '166')
  data.websiteVisits.total = 0
  assert.equal(card(mapSocialMediaReport(data), 'reach').value, '163')
  data.websiteVisits.status = 'unavailable'
  assert.equal(card(mapSocialMediaReport(data), 'reach').value, 'Not available')
  Object.assign(data.websiteVisits, { status: 'available', total: 3 })
  metric('page_video_views').status = 'unavailable'
  assert.equal(card(mapSocialMediaReport(data), 'reach').value, 'Not available')
  facebook.commentCounts.complete = false
  assert.equal(card(mapSocialMediaReport(data), 'interactions').value, 'Not available')
})
