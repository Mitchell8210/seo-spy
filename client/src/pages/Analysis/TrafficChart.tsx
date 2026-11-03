import { useId, useState } from 'react'
import type { AnalyticsData, TrafficMetric } from './analysisRevenue'
import { number } from './analysisRevenue'
const metrics = ['users', 'sessions', 'conversions'] as const
export function TrafficChart({ data }: { data: AnalyticsData }) {
  const [metric, setMetric] = useState<TrafficMetric>('users')
  const gradient = useId()
  const max = Math.max(1, ...data.daily.map(day => day[metric]))
  const points = data.daily.map((day, index) => ({ x: 45 + index / Math.max(1, data.daily.length - 1) * 530, y: 230 - day[metric] / max * 190, ...day }))
  const line = points.map(point => `${point.x},${point.y}`).join(' ')
  return <section aria-labelledby="traffic-title" className="min-w-0 rounded-2xl border border-blue-400/20 bg-surface p-5 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="traffic-title" className="text-lg font-semibold text-ink">Traffic Over Time</h2><p className="mt-2 text-xs text-muted">{data.period}</p></div><div role="group" aria-label="Traffic metric" className="flex flex-wrap gap-1 rounded-lg border border-line bg-canvas p-1">{metrics.map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)} className={`min-h-9 rounded-md px-3 text-xs capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${metric === value ? 'bg-blue-600 text-white' : 'text-secondary hover:bg-elevated'}`}>{value}</button>)}</div></header>
    {data.source === 'unavailable' || !points.length ? <p className="flex min-h-72 items-center justify-center text-sm text-muted">Traffic history is not available.</p> : <div className="mt-5"><svg viewBox="0 0 600 270" className="block min-h-48 w-full sm:min-h-72" role="img" aria-label={`${metric} over 30 illustrative days. Demo analytics.`}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22C55E" stopOpacity="0.22" /><stop offset="100%" stopColor="#22C55E" stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(index => <g key={index}><line x1="45" x2="575" y1={40 + index * 47.5} y2={40 + index * 47.5} stroke="currentColor" className="text-line" /><text x="35" y={44 + index * 47.5} textAnchor="end" fill="currentColor" className="text-muted text-[20px] sm:text-[10px]">{new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(max * (4 - index) / 4)}</text></g>)}
      <polygon points={`45,230 ${line} 575,230`} fill={`url(#${gradient})`} /><polyline points={line} fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map(point => <circle key={point.day} cx={point.x} cy={point.y} r="3" fill="#22C55E" tabIndex={0} role="img" aria-label={`Day ${point.day}: ${point[metric]} ${metric}`} className="focus:stroke-white focus:stroke-2"><title>Day {point.day}: {number(point[metric])} {metric}</title></circle>)}
      {[0, 7, 14, 21, points.length - 1].filter((value, index, all) => all.indexOf(value) === index && points[value]).map(index => <text key={index} x={points[index].x} y="255" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fill="currentColor" className="text-muted text-[20px] sm:text-[10px]">Day {points[index].day}</text>)}
    </svg><p className="mt-2 text-xs text-muted">Select a metric. Focus or hover a point for its value.</p></div>}
  </section>
}
