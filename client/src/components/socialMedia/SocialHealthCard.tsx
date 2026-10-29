import { ArrowDownRight, ArrowUpRight, Eye, Heart, MessageCircle, Users } from 'lucide-react'
import type { SocialHealthMetric } from '../../types/socialMedia'

const treatments = {
  followers: { icon: Users, tile: 'border-blue-400/25 bg-blue-400/10 text-blue-300' },
  reach: { icon: Eye, tile: 'border-sky-400/25 bg-sky-400/10 text-sky-300' },
  contacts: { icon: MessageCircle, tile: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-300' },
  interactions: { icon: Heart, tile: 'border-teal-400/25 bg-teal-400/10 text-teal-300' },
}

export function SocialHealthCard({ metric }: { metric: SocialHealthMetric }) {
  const { icon: Icon, tile } = treatments[metric.id]
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-blue-400/15 bg-surface p-5 shadow-lg shadow-black/10 sm:p-6">
      <div className={`mb-5 flex size-16 items-center justify-center rounded-2xl border shadow-inner shadow-white/5 ${tile}`}><Icon size={30} strokeWidth={1.75} aria-hidden="true" /></div>
      <h3 className="min-h-12 text-sm font-semibold leading-6 text-secondary">{metric.title}</h3>
      <p className="mt-2 text-[2.75rem] font-semibold tracking-tight text-ink">{metric.value}</p>
      <dl className="mt-6 space-y-3.5 border-t border-line pt-5">{metric.supporting.map((item) => {
        const negative = item.id === 'unfollowed'
        const Indicator = negative ? ArrowDownRight : ArrowUpRight
        return (
          <div key={item.id} className="flex items-start justify-between gap-3">
            <dt className="flex min-w-0 flex-1 items-start gap-2 text-sm leading-6 text-muted">
              <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md ${negative ? 'bg-red-400/10 text-red-400' : 'bg-emerald-400/10 text-emerald-400'}`}>
                <Indicator size={15} aria-hidden="true" /><span className="sr-only">{negative ? 'People lost: ' : 'Positive activity: '}</span>
              </span>
              <span>{item.label}</span>
            </dt>
            <dd className="shrink-0 text-base font-semibold text-ink">{item.value}</dd>
          </div>
        )
      })}</dl>
    </article>
  )
}
