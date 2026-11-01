import { Users, Eye, MousePointer2, Heart } from 'lucide-react'
import { FacebookMark } from '../common/FacebookMark'
import type { SocialResults } from '../../types/dashboard'

const icons = { followers: Users, reach: Eye, engagement: Heart, interactions: MousePointer2 }

export function SocialPerformance({ results, caption = 'Mock metrics' }: { results: SocialResults; caption?: string }) {
  return (
    <section aria-labelledby="social-performance-title" className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2.5"><FacebookMark /><h3 id="social-performance-title" className="font-semibold text-ink">Social Media Performance</h3></div>
      <p className="mt-1.5 text-xs leading-5 text-muted">{results.account} · {caption}</p>
      <dl className="my-6 grid flex-1 grid-cols-2 gap-5">
        {results.metrics.map((metric) => {
          const Icon = icons[metric.id]
          return <div key={metric.id} className="min-w-0"><dt className="flex items-center gap-2 text-xs leading-5 text-secondary"><Icon size={16} className="shrink-0 text-muted" aria-hidden="true" />{metric.label}</dt><dd className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{metric.value}</dd></div>
        })}
      </dl>
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-xs text-muted">Interaction breakdown · Last 30 days</p>
        <dl className="grid grid-cols-3 gap-3 rounded-lg bg-elevated p-3">{results.secondary.map((metric) => <div key={metric.label}><dt className="text-xs text-secondary">{metric.label}</dt><dd className="mt-1 text-lg font-semibold text-ink">{metric.value}</dd></div>)}</dl>
      </div>
    </section>
  )
}
