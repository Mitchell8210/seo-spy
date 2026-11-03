import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapAnalysisResponse } from '../src/services/analysisApi.ts'
import { analyticsTotals, estimateRevenue } from '../src/pages/Analysis/analysisRevenue.ts'

const fixture = () => ({ schemaVersion: 'seo-spy.google-analysis.v2', businessId: 'demo-guzman', provider: 'ga4', availability: 'available', errorCode: null,
  cache: { hit: false, stale: false }, data: { schemaVersion: 'seo-spy.google-analysis-data.v2', hostname: 'guzmantaxaccounting.com', collectedAt: '2026-11-02T12:00:00.000Z',
    dateRange: { startDate: '2026-10-03', endDate: '2026-11-01', timeZone: 'America/Los_Angeles' }, totals: { users: 12, sessions: 20, conversions: 5, rate: 25 },
    conversion: { status: 'available', eventName: 'form_submit', pagePaths: ['/contacto/'], users: 3, reason: null },
    daily: [{ date: '2026-10-31', users: 9, sessions: 12, conversions: 3 }, { date: '2026-11-01', users: 9, sessions: 8, conversions: 2 }],
    channels: [{ label: 'Unassigned', value: 20 }], devices: [{ label: 'desktop', value: 9 }, { label: 'mobile', value: 5 }], pages: [{ path: '/contact', users: 8 }],
    metadata: Array.from({ length: 5 }, () => ({ subjectToThresholding: false, dataLossFromOtherRow: false, sampling: [] })) } })

test('real totals and conversion rate are independent of daily unique-user sums and event/user ratios', () => {
  const view = mapAnalysisResponse(fixture(), 'demo-guzman')
  assert.equal(view.data.source, 'ga4')
  assert.deepEqual(analyticsTotals(view.data), { users: 12, sessions: 20, conversions: 5, rate: 25 })
  assert.deepEqual(view.data.daily.map(row => row.day), [29, 30])
  assert.equal(view.data.channels[0].label, 'Unassigned')
  assert.equal(estimateRevenue(analyticsTotals(view.data).users, '150', '2').revenue, 36)
  assert.equal(view.caption, 'Google Analytics · guzmantaxaccounting.com · Past 30 days')
  assert.doesNotMatch(view.caption, /demo|illustrative/i)
})
test('empty is zero while unavailable and stale failures never masquerade as current traffic', () => {
  const value = fixture(); value.availability = 'empty'; value.data.totals = { users: 0, sessions: 0, conversions: null, rate: null }
  value.data.conversion = { ...value.data.conversion, status: 'unavailable', users: null, reason: 'no_recorded_submissions' }
  value.data.daily = []; value.data.channels = []; value.data.devices = []; value.data.pages = []
  assert.equal(analyticsTotals(mapAnalysisResponse(value, 'demo-guzman').data).users, 0)
  for (const unavailable of [{ ...fixture(), availability: 'unavailable', errorCode: 'GOOGLE_PERMISSION_DENIED' }, { ...fixture(), cache: { hit: true, stale: true } }]) {
    assert.deepEqual(analyticsTotals(mapAnalysisResponse(unavailable, 'demo-guzman').data), { users: null, sessions: null, conversions: null, rate: null })
  }
})
test('missing submission tracking keeps real traffic visible without inventing zero conversions', () => {
  const value = fixture()
  value.data.conversion = { ...value.data.conversion, status: 'unavailable', users: null, reason: 'no_recorded_submissions' }
  value.data.totals.conversions = null; value.data.totals.rate = null
  value.data.daily.forEach(row => { row.conversions = null })
  const view = mapAnalysisResponse(value, 'demo-guzman')
  assert.deepEqual(analyticsTotals(view.data), { users: 12, sessions: 20, conversions: null, rate: null })
  assert.equal(view.data.channels.length, 1)
  assert.equal(view.caption, 'Google Analytics · guzmantaxaccounting.com · Past 30 days')
  value.data.totals.conversions = 0
  assert.throws(() => mapAnalysisResponse(value, 'demo-guzman'))
})
test('successful empty inquiry reports show recorded zero conversions with a tracking-coverage caveat', () => {
  const value = fixture()
  value.data.conversion = { ...value.data.conversion, users: 0, reason: 'no_recorded_submissions' }
  value.data.totals.conversions = 0; value.data.totals.rate = 0
  value.data.daily.forEach(row => { row.conversions = 0 })
  const view = mapAnalysisResponse(value, 'demo-guzman')
  assert.equal(analyticsTotals(view.data).conversions, 0)
  assert.equal(analyticsTotals(view.data).rate, 0)
  assert.equal(view.caption, 'Google Analytics · guzmantaxaccounting.com · Past 30 days')
})
test('rejects mismatched identities, malformed measurements, dates, and duplicate rows', () => {
  for (const change of [
    value => { value.businessId = 'other' }, value => { value.data.totals.users = -1 }, value => { value.data.totals.rate = 120 },
    value => { value.data.daily[0].date = '2020-01-01' }, value => { value.data.dateRange.timeZone = 'invalid' },
    value => { value.data.daily.push(value.data.daily[0]) }, value => { value.data.totals = undefined },
  ]) {
    const value = fixture(); change(value)
    assert.throws(() => mapAnalysisResponse(value, 'demo-guzman'))
  }
})
