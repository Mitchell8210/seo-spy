import { BadgeCheck, TrendingUp } from 'lucide-react'
import type { Score } from '../../types/dashboard'
import { ScoreCard } from '../dashboard/ScoreCard'

export function SocialScoreHero({ score, summary, benchmark }: { score: Score; summary: string; benchmark: { percentile: number } }) {
  return (
    <section aria-labelledby="social-score-title" className="overflow-hidden rounded-2xl border border-blue-400/30 bg-surface p-5 shadow-xl shadow-black/15 sm:p-8">
      <div className="grid items-center gap-7 md:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_240px]">
        <div className="flex justify-center rounded-2xl border border-blue-400/15 bg-elevated px-2 py-6 shadow-inner shadow-black/10"><ScoreCard score={score} prominent /></div>
        <div className="min-w-0">
          <p className="mb-4 inline-flex rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-blue-300">YOUR SOCIAL PRESENCE</p>
          <h2 id="social-score-title" className="text-lg font-semibold leading-7 tracking-tight text-blue-200">SEO Spy Social Media Score</h2>
          <p className="mt-3 text-2xl font-semibold leading-9 tracking-tight text-ink sm:text-[1.7rem]">{summary}</p>
          <p className="mt-4 text-xs leading-6 text-muted">Mock score · Same as the Dashboard’s social media component score.</p>
        </div>
        <div className="min-w-0 md:col-span-2 md:grid md:grid-cols-2 md:items-center md:gap-5 xl:col-span-1 xl:block">
          <div data-performance-graphic aria-hidden="true" className="mb-4 rounded-xl border border-blue-400/10 bg-elevated/50 px-3 pt-4 md:mb-0 xl:mb-4">
            <svg viewBox="0 0 240 116" className="h-28 w-full" fill="none">
              <path d="M12 96H228M12 64H228M12 32H228" stroke="currentColor" className="text-blue-400/10" />
              <g className="text-blue-400/20" fill="currentColor">
                <rect x="21" y="76" width="22" height="20" rx="4" /><rect x="60" y="64" width="22" height="32" rx="4" /><rect x="99" y="50" width="22" height="46" rx="4" /><rect x="138" y="34" width="22" height="62" rx="4" /><rect x="177" y="16" width="22" height="80" rx="4" />
              </g>
              <path d="M15 78 60 64 102 57 144 34 211 12M195 12H211V28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400" />
              <circle cx="144" cy="34" r="4" fill="currentColor" className="text-blue-300" />
            </svg>
          </div>
          <aside aria-label="Mock benchmark insight" className="rounded-xl border border-blue-400/25 bg-blue-400/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-blue-300"><BadgeCheck size={20} aria-hidden="true" /><p className="text-sm font-semibold text-ink">You’re doing well!</p><TrendingUp size={16} className="ml-auto shrink-0" aria-hidden="true" /></div>
            <p className="text-sm leading-6 text-secondary">Your score is higher than <strong className="font-semibold text-ink">{benchmark.percentile}%</strong> of similar local businesses.</p>
            <p className="mt-2 text-xs leading-5 text-muted">Mock benchmark · Demo comparison</p>
          </aside>
        </div>
      </div>
    </section>
  )
}
