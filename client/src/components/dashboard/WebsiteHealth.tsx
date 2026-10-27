import { CircleCheck, CircleAlert, MonitorCheck } from 'lucide-react'
import type { WebsiteResults } from '../../types/dashboard'
import { ScoreCard } from './ScoreCard'

export function WebsiteHealth({ results }: { results: WebsiteResults }) {
  return (
    <section aria-labelledby="website-health-title" className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2.5"><MonitorCheck size={21} className="text-blue-300" aria-hidden="true" /><h3 id="website-health-title" className="font-semibold text-ink">Website Health</h3></div>
      <p className="mt-1.5 text-xs text-muted">Website quality · Mock results</p>
      <div className="my-7 grid grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">{results.categories.map((score) => <ScoreCard key={score.id} score={score} theme="dark" />)}</div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-sm font-medium text-secondary">{results.overall.label}</p>
        <p className="shrink-0 text-2xl font-semibold text-ink">{results.overall.value}<span className="ml-1 text-xs font-normal text-muted">/ {results.overall.maximum}</span></p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-elevated p-3">
        <div><p className="flex items-center gap-1.5 text-lg font-semibold text-ink"><CircleAlert size={15} className="text-amber-300" aria-hidden="true" />{results.issues}</p><p className="mt-1 text-xs leading-5 text-secondary">Issues requiring attention</p></div>
        <div><p className="flex items-center gap-1.5 text-lg font-semibold text-ink"><CircleCheck size={15} className="text-emerald-300" aria-hidden="true" />{results.checksPassed}</p><p className="mt-1 text-xs leading-5 text-secondary">Checks passed</p></div>
      </div>
    </section>
  )
}
