import type { DashboardFinding } from '../../types/dashboardLive'
import { findingStatuses } from '../../utils/findingStatus'
import { StatusBadge } from '../common/StatusBadge'

export function FindingCard({ finding }: { finding: DashboardFinding }) {
  return (
    <article className="px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={finding.severity} tone={findingStatuses[finding.severity].tone} theme="dark" />
        <span className="text-xs font-medium text-secondary">{finding.source}</span>
      </div>
      <h3 className="mt-2 text-sm font-semibold leading-6 text-ink">{finding.title}</h3>
      <p className="mt-1 text-sm leading-5 text-secondary">{finding.explanation}</p>
      <p className="mt-2 text-xs font-medium text-muted">{finding.status}</p>
    </article>
  )
}
