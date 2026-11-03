import { ChartNoAxesCombined, Eye, MousePointer, TrendingUp, Users } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { mockBusiness } from '../../data/mockBusiness'
import { useAnalysis } from '../../hooks/useAnalysis'
import { analyticsTotals, number } from './analysisRevenue'
import { RevenueCalculator } from './RevenueCalculator'
import { TrafficChart } from './TrafficChart'

const channelColors: Record<string, string> = { 'Organic Search': '#10B981', Direct: '#A855F7', Referral: '#22D3EE', Social: '#EC4899', Other: '#94A3B8', 'Paid Search': '#3B82F6' }
const panel = 'min-w-0 rounded-2xl border border-blue-400/20 bg-surface p-5 sm:p-6'
export function Analysis() {
  const [search] = useSearchParams()
  const businessId = search.get('businessId')?.trim() || mockBusiness.id
  const { data, caption } = useAnalysis(businessId)
  const totals = analyticsTotals(data)
  const kpis = [
    { label: 'Users', value: number(totals.users), icon: Users, accent: '#2F9BFF' },
    { label: 'Sessions', value: number(totals.sessions), icon: Eye, accent: '#8B5CF6' },
    { label: 'Conversions', value: number(totals.conversions), icon: MousePointer, accent: '#22C55E' },
    { label: 'Conversion Rate', value: totals.rate === null ? '—' : `${totals.rate.toFixed(1)}%`, icon: TrendingUp, accent: '#F59E0B' },
  ]
  const channelTotal = data.channels.reduce((sum, channel) => sum + channel.value, 0)
  const channelFill = data.channels.map((channel, index) => {
    const before = data.channels.slice(0, index).reduce((sum, item) => sum + item.value, 0)
    const start = channelTotal ? before / channelTotal * 100 : 0
    const end = channelTotal ? (before + channel.value) / channelTotal * 100 : 0
    return `${channelColors[channel.label] ?? channelColors.Other} ${start}% ${end}%`
  }).join(', ')
  const deviceMax = Math.max(1, ...data.devices.map(device => device.value))
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Analysis &amp; Revenue</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">See your traffic, performance trends, and the potential business value of your online visibility.</p></header>
    <p className="flex items-start gap-2 text-xs leading-5 text-muted"><ChartNoAxesCombined size={16} className="mt-0.5 shrink-0 text-blue-300" aria-hidden="true" />{caption}</p>
    <section aria-label="Analytics summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis.map(({ label, value, icon: Icon, accent }) => <article key={label} className="min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5"><div className="flex items-center gap-2 text-secondary"><span className="relative inline-flex size-[17px] shrink-0"><span className="absolute left-[5px] top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg" style={{ color: accent, backgroundColor: `${accent}1f` }}><Icon size={22} aria-hidden="true" /></span></span><h2 className="text-xs font-medium">{label}</h2></div><p className="mt-3 text-2xl font-semibold text-ink" data-analysis-kpi={label}>{value}</p></article>)}</section>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <div className="contents xl:block xl:min-w-0 xl:space-y-5">
        <div className="order-1 min-w-0"><TrafficChart data={data} /></div>
        <div className="order-3 grid min-w-0 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
      <section aria-labelledby="channel-title" className={panel}><h2 id="channel-title" className="text-base font-semibold text-ink">Traffic by Channel</h2><p className="mt-2 text-xs text-muted">Google Analytics sessions by acquisition channel</p>{channelTotal ? <><div className="relative mx-auto my-5 size-36 rounded-full" style={{ background: `conic-gradient(${channelFill})` }} role="img" aria-label={data.channels.map(channel => `${channel.label}: ${number(channel.value)} sessions`).join(', ')}><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-surface"><span className="text-xl font-semibold text-ink">{number(channelTotal)}</span><span className="text-[10px] text-muted">sessions</span></div></div><ul className="space-y-3">{data.channels.map(channel => <li key={channel.label} className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-secondary"><span className="size-2 rounded-full" style={{ background: channelColors[channel.label] ?? channelColors.Other }} aria-hidden="true" />{channel.label}</span><span className="font-medium text-ink">{number(channel.value)}</span></li>)}</ul></> : <p className="py-8 text-sm text-muted">Channel data is not available.</p>}</section>
      <section aria-labelledby="device-title" className={panel}><h2 id="device-title" className="text-base font-semibold text-ink">Users by Device</h2><p className="mt-2 text-xs text-muted">Google Analytics users by device</p><div className="mt-7 space-y-6">{data.devices.length ? data.devices.map(device => <div key={device.label}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="text-secondary">{device.label}</span><span className="font-medium text-ink">{number(device.value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-elevated" aria-hidden="true"><div className="h-full rounded-full bg-blue-400" style={{ width: `${device.value / deviceMax * 100}%` }} /></div></div>) : <p className="text-sm text-muted">Device data is not available.</p>}</div></section>
      <section aria-labelledby="pages-title" className={panel}><h2 id="pages-title" className="text-base font-semibold text-ink">Top Pages</h2><div className="mt-5 flex justify-between border-b border-line pb-3 text-[11px] text-muted"><span>Page</span><span>Users</span></div><ul className="divide-y divide-line">{data.pages.slice(0, 5).map(page => <li key={page.path} className="flex items-start justify-between gap-3 py-4 text-xs"><span className="min-w-0 break-all leading-5 text-secondary">{page.path}</span><span className="shrink-0 pt-0.5 font-medium text-ink">{number(page.users)}</span></li>)}</ul>{!data.pages.length && <p className="py-8 text-sm text-muted">Page data is not available.</p>}</section>
        </div>
      </div>
      <div className="order-2 min-w-0"><RevenueCalculator key={businessId} visitors={totals.users} demo={false} /></div>
    </div>
  </div>
}
