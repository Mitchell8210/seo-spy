import type { WebsiteRecommendation, WebsiteFinding } from '../../types/website'
import { findingStatuses } from '../../utils/findingStatus'
import { StatusBadge } from '../common/StatusBadge'

export function RecommendationCard({ recommendation, finding, pageUrl }: { recommendation: WebsiteRecommendation; finding: WebsiteFinding; pageUrl?: string }) {
  return (
    <article className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted">Priority</span><StatusBadge label={finding.severity} tone={findingStatuses[finding.severity].tone} /></div>
      <h3 className="mt-3 text-sm font-semibold leading-6 text-ink">{finding.title}</h3>
      <p className="mt-2 text-sm leading-6 text-secondary">{recommendation.action}</p>
      {pageUrl && <p className="mt-3 break-all text-xs leading-5 text-muted"><span className="font-medium">Affected page: </span>{pageUrl}</p>}
      <p className="mt-3 text-xs text-blue-300">Suggested change · Not applied</p>
    </article>
  )
}
