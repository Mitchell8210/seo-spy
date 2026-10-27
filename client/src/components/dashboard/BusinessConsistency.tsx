import { ArrowLeftRight, CheckCircle2, CircleAlert } from 'lucide-react'
import type { ConsistencyResults } from '../../types/dashboard'
import { findingStatuses } from '../../utils/findingStatus'
import { ScoreCard } from './ScoreCard'

export function BusinessConsistency({ results }: { results: ConsistencyResults }) {
  return (
    <section aria-labelledby="consistency-title" className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 id="consistency-title" className="font-semibold text-ink">Business Consistency</h2>
        <p className="inline-flex items-center gap-2 text-xs font-medium text-secondary"><ArrowLeftRight size={15} aria-hidden="true" />{results.channels} · Mock comparison</p>
      </div>
      <div className="grid gap-6 xl:grid-cols-[180px_1fr]">
        <div className="flex items-center justify-center rounded-lg bg-elevated p-4"><ScoreCard score={results.score} theme="dark" /></div>
        <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {results.checks.map((check) => {
            const Icon = check.matches ? CheckCircle2 : CircleAlert
            return (
              <li key={check.id} className="min-w-0">
                <p className="flex items-start gap-2 text-sm font-medium text-ink"><Icon size={16} className={`mt-0.5 shrink-0 ${check.matches ? 'text-emerald-400' : findingStatuses.Medium.icon}`} aria-hidden="true" />{check.label}</p>
                <dl className="mt-2 space-y-1 pl-6 text-xs leading-5 text-secondary">
                  <div className="flex flex-wrap gap-x-1"><dt>Website:</dt><dd className="break-all">{check.website}</dd></div>
                  <div className="flex flex-wrap gap-x-1"><dt>Facebook:</dt><dd className="break-all">{check.social}</dd></div>
                </dl>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
