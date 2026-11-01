import { ArrowUpRight } from 'lucide-react'
import type { DashboardMainScore } from '../../types/dashboardLive'
import { getScoreStatus } from '../../utils/scoreStatus'
import { SpyLogo } from '../common/SpyLogo'
import { ScoreCard } from './ScoreCard'

export function MainSpyScore({ results, live = false }: { results: DashboardMainScore; live?: boolean }) {
  return (
    <section aria-labelledby="main-spy-title" className="rounded-2xl border border-blue-700 bg-surface p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex items-center gap-3 border-b border-line pb-5">
        <SpyLogo />
        <div><p className="mb-1 text-xs font-semibold tracking-wide text-blue-300">SEO SPY · DIGITAL PRESENCE</p><h2 id="main-spy-title" className="text-2xl font-semibold tracking-tight text-ink">Main Spy Score</h2></div>
      </div>
      <div className="grid items-center gap-7 xl:grid-cols-[280px_1fr]">
        <div className="rounded-xl bg-elevated px-5 py-6">
          <ScoreCard score={results.overall} prominent theme="dark" live={live} />
          <p className="mt-3 text-center text-xs text-muted">{live ? 'Combined scoring is not available' : 'Mock overall score'}</p>
        </div>
        <div>
          <p className="text-xl font-semibold leading-8 tracking-tight text-ink sm:text-2xl">{results.overall.value === null ? 'Your Total SEO Spy Score is not available' : `Your Total SEO Spy Score is ${results.overall.value}/${results.overall.maximum}`}</p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">{live ? 'Website, social media, and business consistency scores have not been combined into an overall score.' : 'Calculated from your website health, social media performance, and cross-channel business consistency.'}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-blue-300"><ArrowUpRight size={15} aria-hidden="true" />{results.priorityOpportunities ?? '—'} priority opportunities</p>
          <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-line pt-5 sm:grid-cols-3">
            {results.components.map((score) => {
              const status = score.value === null ? { dark: 'text-muted', label: 'Not available' } : getScoreStatus(score.value / score.maximum * 100)
              return <div key={score.id}><dt className="text-xs text-secondary">{score.label}</dt><dd className="mt-1 flex flex-wrap items-baseline gap-2"><span className="text-xl font-semibold text-ink">{score.value ?? '—'}<span className="ml-1 text-xs font-normal text-muted">/ {score.maximum}</span></span><span className={`text-xs font-medium ${status.dark}`}>{status.label}</span></dd></div>
            })}
          </dl>
          <p className="mt-5 text-xs leading-6 text-muted">Website Health + Social Media Performance + Business Consistency = Total SEO Spy Score</p>
        </div>
      </div>
    </section>
  )
}
