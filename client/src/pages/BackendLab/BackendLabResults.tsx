import { FindingCard } from '../../components/findings/FindingCard'
import { StatusBadge } from '../../components/common/StatusBadge'
import type { Evidence, Finding, LighthouseReport, Recommendation } from './types'
import { formatTime } from './format'

const categoryLabels = [
  ['performance', 'Performance'], ['accessibility', 'Accessibility'],
  ['best-practices', 'Best practices'], ['seo', 'SEO'],
] as const

export function LighthouseResults({ report, simulated }: { report: LighthouseReport | null; simulated: boolean }) {
  return (
    <section aria-labelledby="lab-results-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="lab-results-title" className="text-base font-semibold text-ink">Lighthouse results</h2>
        <p className="text-xs text-muted">{report ? `${report.strategy === 'mobile' ? 'Mobile' : 'Desktop'} lab test · ${formatTime(report.fetchedAt)}` : 'No measured Lighthouse report available'}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {categoryLabels.map(([id, label]) => {
          const category = report?.categories.find((item) => item.id === id)
          const measured = category?.availability === 'measured' && category.score !== null
          return (
            <article key={id} data-testid={`lab-category-${id}`} className="rounded-xl border border-line bg-surface p-5 shadow-sm">
              <h3 className="text-sm font-medium text-secondary">{label}</h3>
              <p className="mt-4 text-4xl font-semibold tracking-tight text-ink">{measured ? category.score : '—'}{measured && <span className="ml-1 text-sm font-normal text-muted">/100</span>}</p>
              <p className="mt-3 text-xs text-muted">{measured ? 'Measured by Google Lighthouse' : 'Unavailable'}</p>
            </article>
          )
        })}
      </div>
      {!report && <p className="text-sm leading-6 text-secondary">{simulated ? 'The backend currently has simulated demo results. Run a Lighthouse investigation to collect real measurements.' : 'An HTML-only or incomplete investigation can have findings without Lighthouse scores. Run Lighthouse or review the audit status above.'}</p>}
      {report && (
        <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
            {report.metrics.map((metric) => (
              <div key={metric.id}>
                <h3 className="text-xs font-medium text-muted">{metric.title}</h3>
                <p className="mt-2 text-lg font-semibold text-ink">{metric.value === null ? 'Unavailable' : metric.displayValue ?? `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${metric.unit === 'ms' ? ' ms' : ''}`}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 border-t border-line pt-4 text-xs leading-5 text-muted">Google PageSpeed Insights · Lighthouse {report.lighthouseVersion} · Lab measurements vary between runs. These are not real-user Core Web Vitals or a guarantee of accessibility compliance.</p>
          <p className="mt-2 break-all text-xs text-muted">Measured page: {report.finalUrl}</p>
        </div>
      )}
    </section>
  )
}

function observation(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed, null, 2) : value
  } catch {
    return value
  }
}

function EvidenceDetails({ evidence }: { evidence: Evidence[] }) {
  return (
    <details className="border-t border-line px-5 py-4 text-sm sm:px-6">
      <summary className="cursor-pointer font-medium text-blue-300">View evidence ({evidence.length})</summary>
      <div className="mt-4 space-y-5">
        {evidence.map((item) => (
          <div key={item.id} className="min-w-0 space-y-2">
            <p className="break-all text-xs font-medium text-secondary">{item.checkId}</p>
            <p className="break-all text-xs text-muted">{item.sourceUrl} · {formatTime(item.collectedAt)}</p>
            <dl className="space-y-3">
              {Object.entries(item.observed).map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-xs font-medium text-secondary">{key}</dt>
                  <dd className="mt-1 max-h-64 overflow-auto rounded-lg bg-canvas p-3"><pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted">{observation(value)}</pre></dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  )
}

export function AuditFindings({ findings, evidence, recommendations, simulated }: {
  findings: Finding[]; evidence: Evidence[]; recommendations: Recommendation[]; simulated: boolean
}) {
  const severities = { critical: 'Critical', medium: 'Medium', low: 'Low' } as const
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section aria-labelledby="lab-findings-title" className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4 sm:px-6">
          <h2 id="lab-findings-title" className="text-base font-semibold text-ink">Findings</h2>
          <StatusBadge label={`${findings.length} ${simulated ? 'simulated ' : ''}findings`} />
        </div>
        {findings.length === 0 && <p className="px-5 py-5 text-sm leading-6 text-secondary">No findings are available for these results. Check the audit status and coverage before drawing conclusions.</p>}
        <div className="divide-y divide-line">
          {findings.map((finding) => (
            <div key={finding.id} className="min-w-0 break-words">
              <FindingCard finding={{ ...finding, severity: severities[finding.severity], source: finding.source === 'website_and_facebook' ? 'Website + Facebook' : 'Website', status: 'Needs review' }} />
              <EvidenceDetails evidence={evidence.filter((item) => finding.evidenceIds.includes(item.id))} />
            </div>
          ))}
        </div>
        {evidence.length > 0 && <EvidenceDetails evidence={evidence} />}
      </section>
      <section aria-labelledby="lab-recommendations-title" className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h2 id="lab-recommendations-title" className="text-base font-semibold text-ink">Recommendations</h2>
          <p className="mt-1 text-sm leading-6 text-secondary">Review suggestions against their evidence. Running an investigation does not change the website.</p>
        </div>
        {recommendations.length === 0 && <p className="px-5 py-5 text-sm text-secondary">No recommendations are available for these results.</p>}
        <ol className="divide-y divide-line">
          {recommendations.map((recommendation, index) => (
            <li key={recommendation.id} className="flex min-w-0 gap-3 px-5 py-4 sm:px-6">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-blue-300">{index + 1}</span>
              <div className="min-w-0 break-words">
                <h3 className="text-sm font-semibold leading-6 text-ink">{recommendation.title}</h3>
                <p className="mt-1 text-sm leading-6 text-secondary">{recommendation.explanation}</p>
                <p className="mt-3 text-sm leading-6 text-secondary">{recommendation.recommendedChange}</p>
                <p className="mt-2 text-xs leading-5 text-muted">{recommendation.purpose} · Needs review</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
