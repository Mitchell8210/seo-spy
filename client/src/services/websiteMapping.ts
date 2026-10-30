import type { LighthouseReport } from '../types/backend'
import type { LiveWebsiteAudit, WebsiteCategory } from '../types/website'
import type { WebsiteReport } from '../types/websiteApi'

const categories = [
  { id: 'performance', label: 'Performance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'seo', label: 'SEO' },
]
const htmlCategories: Record<string, WebsiteCategory> = {
  'page-title': 'Metadata', 'meta-description': 'Metadata', headings: 'Content',
  canonical: 'Technical SEO', robots: 'Technical SEO', 'image-alt': 'Accessibility',
  'internal-links': 'Technical SEO', 'structured-data': 'Technical SEO',
}
const lighthouseCategories: Record<string, WebsiteCategory> = {
  performance: 'Performance', accessibility: 'Accessibility', seo: 'Technical SEO',
}

export function measurementLabel(report: LighthouseReport) {
  return `Google Lighthouse ${report.lighthouseVersion} · ${report.strategy} lab · ${report.fetchedAt}`
}

function category(checkId: string, report?: LighthouseReport): string {
  if (!checkId.startsWith('lighthouse:')) return htmlCategories[checkId] ?? checkId
  const id = checkId.slice('lighthouse:'.length)
  const matches = report?.categories.filter(item => item.auditIds.includes(id)) ?? []
  return [...new Set(matches.map(item => lighthouseCategories[item.id] ?? item.title))].join(' · ') || checkId
}

export function mapWebsiteReport(record: WebsiteReport): LiveWebsiteAudit {
  const { audit, results } = record
  if (!results) throw new Error('This report has no website results.')
  const report = results.lighthouse
  const summaries = results.evidenceSummaries
  const eligible = new Set(report?.categories.flatMap(item => item.auditIds) ?? [])
  // Only explicit binary passes count. Numeric, manual, skipped and error outcomes do not.
  const passedChecks = report?.checks.filter(item => eligible.has(item.id) && item.scoreDisplayMode === 'binary' && item.score === 1)
    .map(item => ({ id: item.id, title: item.title, status: 'Passed' as const, url: report.finalUrl,
      evidenceLabel: summaries?.checks.find(summary => summary.id === item.id)?.sourceLabel ?? 'Not available',
      evidence: summaries?.checks.find(summary => summary.id === item.id)?.text ?? 'Not available' })) ?? []
  const pages = new Map<string, { id: string; url: string; findingIds: string[] }>()
  const findings = results.findings.filter(item => item.source === 'website').map(item => {
    const evidence = results.evidence.filter(entry => item.evidenceIds.includes(entry.id))
    for (const entry of evidence) {
      const page = pages.get(entry.sourceUrl) ?? { id: entry.sourceUrl, url: entry.sourceUrl, findingIds: [] }
      if (!page.findingIds.includes(item.id)) page.findingIds.push(item.id)
      pages.set(entry.sourceUrl, page)
    }
    return { id: item.id, title: item.title, explanation: item.explanation, status: 'Needs review' as const,
      severity: ({ critical: 'Critical', medium: 'Medium', low: 'Low' } as const)[item.severity], source: 'Website' as const,
      category: category(item.checkId, report), pageId: evidence[0]?.sourceUrl ?? '',
      evidenceLabel: summaries?.findings.find(summary => summary.id === item.id)?.sourceLabel ?? 'Not available',
      evidence: summaries?.findings.find(summary => summary.id === item.id)?.text ?? 'Not available' }
  })
  return {
    id: record.auditId, websiteId: record.business.id, analyzedAt: audit.completedAt ?? record.generatedAt,
    results: {
      overall: { id: 'website-score', label: 'SEO Spy Website Score', value: null, maximum: 100, description: 'Overall website health.' },
      categories: categories.map(item => {
        const measured = report?.categories.find(entry => entry.id === item.id)
        return { ...item, value: measured?.availability === 'measured' ? measured.score : null, maximum: 100, description: measured?.title ?? item.label }
      }),
      issues: findings.length, checksPassed: report ? passedChecks.length : null,
    }, findings, pages: [...pages.values()], passedChecks,
    recommendations: results.recommendations.filter(item => findings.some(finding => finding.id === item.findingId))
      .map(item => ({ id: item.id, findingId: item.findingId, action: item.recommendedChange })),
  }
}
