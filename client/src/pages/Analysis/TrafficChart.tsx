import { useId, useState } from 'react'
import type { PointerEvent } from 'react'
import type { AnalyticsData, TrafficMetric } from './analysisRevenue'
import { number } from './analysisRevenue'
const metrics = ['users', 'sessions', 'conversions'] as const
export function TrafficChart({ data }: { data: AnalyticsData }) {
  const [metric, setMetric] = useState<TrafficMetric>('users')
  const [active, setActive] = useState<{ day: number; metric: TrafficMetric; period: string } | null>(null)
  const readoutId = useId()
  const gradient = useId()
  const availableDays = data.daily.flatMap(day => { const value = day[metric]; return value === null ? [] : [{ ...day, value }] })
  const max = Math.max(1, ...availableDays.map(day => day.value))
  const points = availableDays.map((day, index) => ({ x: 45 + (data.source === 'ga4' ? (day.day - 1) / 29 : index / Math.max(1, availableDays.length - 1)) * 530, y: 230 - day.value / max * 190, ...day }))
  const line = points.map(point => `${point.x},${point.y}`).join(' ')
  const selected = active?.metric === metric && active.period === data.period ? points.find(point => point.day === active.day) : null
  function showPoint(point: typeof points[number]) {
    setActive(previous => previous?.day === point.day && previous.metric === metric && previous.period === data.period
      ? previous : { day: point.day, metric, period: data.period })
  }
  function hover(event: PointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix || !points.length) return
    const location = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    if (location.x < 35 || location.x > 585 || location.y < 25 || location.y > 240) { setActive(null); return }
    const nearest = points.reduce((best, point) => Math.abs(point.x - location.x) < Math.abs(best.x - location.x) ? point : best)
    showPoint(nearest)
  }
  return <section aria-labelledby="traffic-title" className="min-w-0 rounded-2xl border border-blue-400/20 bg-surface p-5 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-4 gap-y-1"><h2 id="traffic-title" className="text-lg font-semibold text-ink">Traffic Over Time</h2><span id={readoutId} data-traffic-readout aria-hidden={!selected} className="inline-block h-5 w-52 shrink-0 whitespace-nowrap text-xs tabular-nums leading-5 text-secondary">{selected && <>{selected.date ?? `Day ${selected.day}`} · <span className="font-semibold text-ink">{number(selected.value)} <span className="capitalize">{metric}</span></span></>}</span></div><p className="mt-2 text-xs text-muted">Past 30 days</p></div><div role="group" aria-label="Traffic metric" className="flex flex-wrap gap-1 rounded-lg border border-line bg-canvas p-1">{metrics.map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => { setMetric(value); setActive(null) }} className={`min-h-9 rounded-md px-3 text-xs capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${metric === value ? 'bg-blue-600 text-white' : 'text-secondary hover:bg-elevated'}`}>{value}</button>)}</div></header>
    {data.source === 'unavailable' || !points.length ? <p className="flex min-h-72 items-center justify-center text-sm text-muted">Traffic history is not available.</p> : <div className="mt-5" onPointerLeave={() => setActive(null)} onKeyDown={event => { if (event.key === 'Escape') setActive(null) }}><svg viewBox="0 0 600 270" onPointerMove={hover} className="block min-h-48 w-full sm:min-h-72" role="img" aria-label={data.source === 'ga4' ? `${metric}: ${data.period}. Google Analytics.` : `${metric} over 30 illustrative days. Demo analytics.`}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22C55E" stopOpacity="0.22" /><stop offset="100%" stopColor="#22C55E" stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(index => <g key={index}><line x1="45" x2="575" y1={40 + index * 47.5} y2={40 + index * 47.5} stroke="currentColor" className="text-line" /><text x="35" y={44 + index * 47.5} textAnchor="end" fill="currentColor" className="text-muted text-[20px] sm:text-[10px]">{new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(max * (4 - index) / 4)}</text></g>)}
      <polygon points={`45,230 ${line} 575,230`} fill={`url(#${gradient})`} /><polyline points={line} fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map(point => <circle key={point.day} cx={point.x} cy={point.y} r={selected?.day === point.day ? 5 : 3} fill="#22C55E" tabIndex={0} role="img" aria-label={`${point.date ?? `Day ${point.day}`}: ${point[metric]} ${metric}`} aria-describedby={selected?.day === point.day ? readoutId : undefined} onFocus={() => showPoint(point)} onBlur={() => setActive(null)} className="focus:stroke-white focus:stroke-2" />)}
      {[0, 7, 14, 21, points.length - 1].filter((value, index, all) => all.indexOf(value) === index && points[value]).map(index => <text key={index} x={points[index].x} y="255" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fill="currentColor" className="text-muted text-[20px] sm:text-[10px]">{points[index].date?.slice(5) ?? `Day ${points[index].day}`}</text>)}
    </svg><p className="mt-2 text-xs text-muted">Select a metric. Focus or hover a point for its value.</p></div>}
  </section>
}
