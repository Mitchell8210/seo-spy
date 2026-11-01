// Explicit saved-data read only. No browser credentials or provider requests.
import assert from 'node:assert/strict'
import process from 'node:process'
import console from 'node:console'
import { mapSocialMediaReport } from '../src/services/socialMediaMapping.ts'

const businessId = process.argv[2] ?? 'demo-guzman'
assert.match(businessId, /^[a-zA-Z0-9_-]{1,128}$/)
const response = await fetch(`http://localhost:3001/api/businesses/${businessId}/facebook-report`, { signal: AbortSignal.timeout(10000) })
assert.equal(response.ok, true)
const data = await response.json()
assert.equal(data.businessId, businessId)
assert.equal(data.report?.business.id, businessId)
const facebook = data.report.results.facebook
assert.equal(facebook.window.basis, 'complete-provider-days')
assert.equal(facebook.window.requestedDays, 30)
for (const name of ['page_post_engagements', 'page_post_likes']) {
  const metric = facebook.metrics.find(item => item.name === name)
  assert.equal(metric?.status, 'available')
  assert.deepEqual(metric.coverage, { complete: true, expectedDays: 30, returnedDays: 30 })
  assert.equal(metric.points.reduce((sum, point) => sum + point.value, 0), metric.total)
}
const view = mapSocialMediaReport(data)
assert.notEqual(view.healthMetrics.find(item => item.id === 'interactions').supporting[0].value, 'Not available')
console.log(JSON.stringify({ reportId: data.report.reportId, window: facebook.window,
  healthMetrics: view.healthMetrics.map(item => ({ title: item.title, value: item.value,
    supporting: item.supporting.map(row => ({ label: row.label, value: row.value })) })),
}, null, 2))
