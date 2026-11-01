import type { WebsiteScore } from '../../types/website'
import { getScoreStatus } from '../../utils/scoreStatus'

type ScoreCardProps = {
  score: WebsiteScore | null
  live?: boolean
  theme?: 'light' | 'dark'
  prominent?: boolean
}

export function ScoreCard({ score, theme = 'dark', prominent = false, live = false }: ScoreCardProps) {
  const measured = score !== null && score.value !== null
  const fraction = score?.value != null ? Math.max(0, Math.min(1, score.value / score.maximum)) : 0
  const status = getScoreStatus(fraction * 100)
  const dark = theme === 'dark'
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <div className={`relative ${prominent ? 'size-44 sm:size-52' : 'size-20'}`} role="img" aria-label={measured ? `${score.label}: ${score.value} out of ${score.maximum}, ${status.label}, ${live ? 'measured score' : 'mock score'}` : 'Score: not available'}>
        <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="40" cy="40" r="33" fill="none" strokeWidth="5" className="stroke-line" />
          {measured && <circle cx="40" cy="40" r="33" fill="none" stroke="currentColor" strokeWidth="5" pathLength="100" strokeDasharray={`${fraction * 100} 100`} strokeLinecap="round" className={dark ? status.dark : status.light} />}
        </svg>
        <span aria-hidden="true" className={`absolute inset-0 flex flex-col items-center justify-center font-semibold tracking-tight ${dark ? 'text-ink' : 'text-ink'} ${prominent ? 'text-6xl' : 'text-2xl'}`}>
          {score?.value ?? '—'}
          {prominent && measured && <span className="mt-1 text-sm font-normal tracking-normal"> / {score.maximum}</span>}
        </span>
      </div>
      {!prominent && <p className={`text-xs font-medium leading-5 ${dark ? 'text-secondary' : 'text-secondary'}`}>{score?.label ?? 'Score'}</p>}
      <p className={`text-xs font-semibold ${measured ? dark ? status.dark : status.light : 'text-muted'}`}>{measured ? status.label : 'Not available'}</p>
    </div>
  )
}
