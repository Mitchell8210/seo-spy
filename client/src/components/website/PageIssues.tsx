import type { AffectedPage, WebsiteFinding } from '../../types/website'
import { findingStatuses } from '../../utils/findingStatus'
import { StatusBadge } from '../common/StatusBadge'

export function PageIssues({ pages, findings }: { pages: AffectedPage[]; findings: WebsiteFinding[] }) {
  return (
    <section aria-labelledby="page-issues-title" className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="border-b border-line p-5 sm:px-6"><h2 id="page-issues-title" className="text-lg font-semibold text-ink">Affected Pages</h2><p className="mt-1 text-sm text-muted">Mock issues grouped by page.</p></div>
      <div className="divide-y divide-line">
        {pages.map((page) => (
          <article key={page.id} className="grid min-w-0 gap-4 p-5 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="min-w-0"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Page URL</h3><p className="mt-2 break-all text-sm leading-6 text-blue-300">{page.url}</p></div>
            <ul className="min-w-0 space-y-4">{page.findingIds.map((id) => {
              const finding = findings.find((item) => item.id === id)
              if (!finding) return null
              return <li key={id} className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1 basis-48"><p className="text-sm font-medium text-ink">{finding.title}</p><p className="mt-1 text-xs text-muted">{finding.category} · {finding.status}</p></div><StatusBadge label={finding.severity} tone={findingStatuses[finding.severity].tone} /></li>
            })}</ul>
          </article>
        ))}
      </div>
    </section>
  )
}
