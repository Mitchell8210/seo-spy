// Offline mapping checks: no backend, browser, provider calls or credentials.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapWebsiteReport, pageReportContext } from '../src/services/websiteMapping.ts'
import { selectWebsiteReports, validateWebsiteReport } from '../src/services/websiteReportSelection.ts'

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

const pageReportId = 'f5cb48c1-6192-48c3-9732-92064d4be5ba'
function pageFixture() {
  const record = fixture()
  const pageUrl = 'https://example.com/bookkeeping/'
  record.reportId = record.auditId = record.audit.id = pageReportId
  record.audit.scope = 'wordpress-page'
  record.audit.warnings = ['One explicitly collected registered page; no homepage or Lighthouse measurement.', 'Image purpose requires operator confirmation.']
  delete record.results.lighthouse
  record.results.evidence = [{ id: 'page-evidence', auditId: pageReportId, checkId: 'image-alt', mode: 'live',
    collectedAt: record.generatedAt, sourceUrl: pageUrl, observed: {
      values: JSON.stringify([{ src: 'data:image/png;base64,placeholder', alt: '', attributes: { 'data-src': 'https://example.com/media/registered-large.png' }, attachmentIds: [5659], pictureSources: [] }]),
      wordpressMediaBinding: JSON.stringify({ mediaId: 5659, pageId: 5652, pageUrl }),
    } }]
  record.results.findings = [{ ...record.results.findings[0], auditId: pageReportId, evidenceIds: ['page-evidence'] }]
  record.results.recommendations = [{ ...record.results.recommendations[0], auditId: pageReportId }]
  record.results.evidenceSummaries = { version: 'programmatic-evidence-v1', auditId: pageReportId, checks: [],
    findings: [{ id: 'finding-one', evidenceIds: ['page-evidence'], text: 'Media 5659 has an empty alt attribute; image purpose requires review.', sourceLabel: 'Saved page HTML · Oct 29, 2026' }] }
  return record
}
function summary(record, overrides = {}) {
  return { reportId: record.reportId, auditId: record.auditId, businessId: record.business.id, scope: record.audit.scope,
    mode: record.audit.mode, status: record.audit.status, ...overrides }
}

test('page evidence never replaces the default homepage/Lighthouse report', () => {
  const records = [summary(pageFixture()), summary(fixture())]
  const selected = selectWebsiteReports(records, 'business-one')
  assert.equal(selected.candidate.auditId, 'audit-one')
  assert.equal(selected.attempts.length, 1)
  assert.equal(selectWebsiteReports([records[0]], 'business-one').candidate, undefined)
})

test('page scope/source slots use saved page observations without homepage coverage claims', () => {
  const record = pageFixture()
  const original = structuredClone(record)
  assert.deepEqual(pageReportContext(record), {
    coverage: record.audit.warnings.join(' '),
    sourceLabel: `https://example.com/bookkeeping/ · ${record.generatedAt}`,
  })
  assert.equal(pageReportContext(fixture()), null)
  assert.equal(pageReportContext(null), null)
  assert.deepEqual(record, original)
  record.audit.warnings = []
  record.results.evidence = []
  assert.deepEqual(pageReportContext(record), { coverage: 'Not available', sourceLabel: 'Not available' })
})

test('explicit saved page report selection retains exact report, finding and evidence identity', () => {
  const record = pageFixture()
  const original = structuredClone(record)
  const selected = selectWebsiteReports([summary(record), summary(fixture())], 'business-one', pageReportId)
  assert.equal(selected.candidate.reportId, pageReportId)
  assert.equal(validateWebsiteReport(record, 'business-one', pageReportId, pageReportId), record)
  const mapped = mapWebsiteReport(record)
  assert.equal(mapped.id, pageReportId)
  assert.equal(mapped.findings[0].id, 'finding-one')
  assert.equal(mapped.findings[0].pageId, 'https://example.com/bookkeeping/')
  assert.equal(mapped.pages[0].url, 'https://example.com/bookkeeping/')
  assert.equal(mapped.recommendations[0].findingId, 'finding-one')
  assert.equal(mapped.findings[0].evidence, record.results.evidenceSummaries.findings[0].text)
  assert.equal(mapped.results.overall.value, null)
  assert.ok(mapped.results.categories.every(item => item.value === null))
  assert.deepEqual(record, original)
})

test('page report is rejected without explicit selection or when ownership/references differ', () => {
  const record = pageFixture()
  assert.throws(() => validateWebsiteReport(record, 'business-one', pageReportId), { code: 'REPORT_MISMATCH' })
  assert.throws(() => validateWebsiteReport(record, 'other-business', pageReportId, pageReportId), { code: 'REPORT_MISMATCH' })
  record.results.evidence[0].auditId = 'unrelated-audit'
  assert.throws(() => validateWebsiteReport(record, 'business-one', pageReportId, pageReportId), { code: 'REPORT_MISMATCH' })
})

test('unknown, malformed, foreign, non-live and failed explicit reports do not fall back silently', () => {
  const page = summary(pageFixture())
  for (const id of ['not-an-id', '89475c06-09c6-4c38-aee9-cd58bd8db460']) {
    assert.throws(() => selectWebsiteReports([page, summary(fixture())], 'business-one', id), { code: 'REPORT_MISMATCH' })
  }
  for (const overrides of [{ businessId: 'other-business' }, { mode: 'demo' }, { status: 'failed' }, { scope: 'facebook' }, { auditId: 'different' }]) {
    assert.throws(() => selectWebsiteReports([{ ...page, ...overrides }, summary(fixture())], 'business-one', pageReportId), { code: 'REPORT_MISMATCH' })
  }
})

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


test('uses only the saved assessment score for this website report', () => {
  const record = fixture()
  const assessment = { businessId: record.business.id, policyVersion: 'seo-spy-score-v1.2', policyHash: 'a'.repeat(64), sources: [{ businessId: record.business.id, reportId: record.auditId, provider: 'website' }], scores: { website: { value: 78, maximum: 100, availability: 'available' } } }
  const original = JSON.stringify(record)
  assert.equal(mapWebsiteReport(record, assessment).results.overall.value, 78)
  assert.equal(mapWebsiteReport(record, assessment).results.categories.find(item => item.id === 'seo').value, 91)
  assert.equal(JSON.stringify(record), original)
  assessment.sources[0].reportId = 'different-report'
  assert.equal(mapWebsiteReport(record, assessment).results.overall.value, null)
})
