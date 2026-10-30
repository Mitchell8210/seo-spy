// Offline mapping checks: no backend, browser, provider calls or credentials.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapWebsiteReport } from '../src/services/websiteMapping.ts'

function fixture() {
  const auditId = 'audit-one'
  const url = 'https://example.com/'
  const timestamp = '2026-10-29T01:57:37.216Z'
  return {
    auditId, reportId: auditId, schemaVersion: 'seo-spy.audit-report.v1', generatedAt: timestamp,
    business: { id: 'business-one', website: url },
    audit: { id: auditId, businessId: 'business-one', scope: 'lighthouse', mode: 'live', status: 'completed', completedAt: timestamp },
    results: {
      evidenceSummaries: {
        version: 'programmatic-evidence-v1', auditId,
        findings: [{ id: 'finding-one', evidenceIds: ['e0', 'e1'], text: 'Backend summary: 2 images have empty descriptions.', sourceLabel: 'Homepage HTML · Oct 29, 2026' }],
        checks: [{ id: 'pass', evidenceIds: [], text: 'Backend summary: this check passed.', sourceLabel: 'Lighthouse · mobile · Oct 29, 2026' }],
      },
      evidence: ['/', '/redirected'].map((pathname, index) => ({ id: `e${index}`, auditId, sourceUrl: new URL(pathname, url).href, checkId: 'image-alt', collectedAt: timestamp, mode: 'live', observed: { html: '<script>unsafe()</script>', emptyCount: '2' } })),
      findings: [{ id: 'finding-one', auditId, checkId: 'image-alt', evidenceIds: ['e0', 'e1'], severity: 'low', source: 'website', title: 'Review alternatives', explanation: 'Empty alt can be intentional.' }],
      recommendations: [{ id: 'recommendation-one', auditId, findingId: 'finding-one', recommendedChange: 'Review image purpose.' }],
      lighthouse: {
        provider: 'google-pagespeed-insights', strategy: 'mobile', fetchedAt: timestamp, lighthouseVersion: '13.0.0', finalUrl: url,
        categories: [
          { id: 'performance', title: 'Performance', availability: 'measured', score: 0, auditIds: ['numeric'] },
          { id: 'accessibility', title: 'Accessibility', availability: 'unavailable', score: null, auditIds: ['pass', 'numeric', 'manual', 'skipped', 'error', 'fail'] },
          { id: 'seo', title: 'SEO', availability: 'measured', score: 91, auditIds: ['pass'] },
        ],
        checks: [
          { id: 'pass', scoreDisplayMode: 'binary', score: 1, title: 'Passing check', description: 'Measured pass' },
          { id: 'numeric', scoreDisplayMode: 'numeric', score: 1 },
          { id: 'manual', scoreDisplayMode: 'manual', score: 1 },
          { id: 'skipped', scoreDisplayMode: 'notApplicable', score: 1 },
          { id: 'error', scoreDisplayMode: 'error', score: null },
          { id: 'fail', scoreDisplayMode: 'binary', score: 0 },
          { id: 'unreferenced', scoreDisplayMode: 'binary', score: 1 },
        ],
      },
    },
  }
}

test('keeps measured zero, unavailable categories and undefined combined score distinct', () => {
  const result = mapWebsiteReport(fixture())
  assert.deepEqual(result.results.categories.map(item => item.value), [0, null, null, 91])
  assert.equal(result.results.overall.value, null)
  assert.equal(result.analyzedAt, fixture().audit.completedAt)
  assert.equal(result.websiteId, 'business-one')
})
test('counts distinct referenced binary passes, excluding numeric/manual/skipped/error and failures', () => {
  const result = mapWebsiteReport(fixture())
  assert.equal(result.results.checksPassed, 1)
  assert.equal(result.passedChecks.length, 1)
  assert.equal(result.passedChecks[0].status, 'Passed')
  assert.equal(result.passedChecks[0].evidence, 'Backend summary: this check passed.')
  assert.match(result.passedChecks[0].evidenceLabel, /Lighthouse.*mobile/)
})
test('displays backend summaries directly while retaining raw evidence and page/recommendation references', () => {
  const record = fixture()
  const original = structuredClone(record)
  const result = mapWebsiteReport(record)
  assert.equal(result.pages.length, 2)
  assert.ok(result.pages.every(item => item.findingIds.includes('finding-one')))
  assert.equal(result.findings[0].evidence, record.results.evidenceSummaries.findings[0].text)
  assert.doesNotMatch(result.findings[0].evidence, /<script>|e0|e1/)
  assert.deepEqual(record, original)
  assert.equal(result.findings[0].severity, 'Low')
  assert.equal(result.recommendations[0].findingId, 'finding-one')
})

test('missing summary stays unavailable instead of dumping raw evidence or inventing copy', () => {
  const record = fixture()
  delete record.results.evidenceSummaries
  assert.equal(mapWebsiteReport(record).findings[0].evidence, 'Not available')
  assert.equal(mapWebsiteReport(record).passedChecks[0].evidence, 'Not available')
})
test('HTML-only partial report has no invented passes, pages or measurements', () => {
  const record = fixture()
  delete record.results.lighthouse
  record.audit.status = 'partial'
  const result = mapWebsiteReport(record)
  assert.equal(result.results.checksPassed, null)
  assert.equal(result.passedChecks.length, 0)
  assert.ok(result.results.categories.every(item => item.value === null))
  assert.equal(result.results.issues, 1)
})
test('unknown check IDs are preserved, and Lighthouse category membership comes from report', () => {
  const record = fixture()
  record.results.findings[0].checkId = 'future-check'
  assert.equal(mapWebsiteReport(record).findings[0].category, 'future-check')
  record.results.findings[0].checkId = 'lighthouse:pass'
  assert.equal(mapWebsiteReport(record).findings[0].category, 'Accessibility · Technical SEO')
})
