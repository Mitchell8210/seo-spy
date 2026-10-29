import { CircleCheck } from 'lucide-react'
import type { PassedCheck } from '../../types/website'
import { StatusBadge } from '../common/StatusBadge'
import { findingStatuses } from '../../utils/findingStatus'

export function PassedChecks({ checks, total }: { checks: PassedCheck[]; total: number }) {
  return (
    <section aria-labelledby="passed-checks-title" className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <h2 id="passed-checks-title" className="text-lg font-semibold text-ink">Passed Checks</h2>
      <p className="mt-1 text-sm text-muted">Showing {checks.length} examples from {total} mock passed checks.</p>
      <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{checks.map((check) => (
        <li key={check.id} className="min-w-0 rounded-lg border border-line bg-elevated p-4">
          <div className="flex items-center justify-between gap-2"><CircleCheck size={18} className="shrink-0 text-blue-400" aria-hidden="true" /><StatusBadge label={check.status} tone={findingStatuses[check.status].tone} /></div>
          <h3 className="mt-3 text-sm font-semibold text-ink">{check.title}</h3><p className="mt-2 text-sm leading-6 text-secondary">{check.evidence}</p><p className="mt-3 break-all text-xs leading-5 text-muted">{check.url}</p>
        </li>
      ))}</ul>
    </section>
  )
}
