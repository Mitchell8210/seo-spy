import { useState } from 'react'
import { Calculator, Coins, Info, TrendingUp } from 'lucide-react'
import { currency, estimateRevenue, number } from './analysisRevenue'

export function RevenueCalculator({ visitors, demo }: { visitors: number | null; demo: boolean }) {
  const [customerValue, setCustomerValue] = useState('150')
  const [conversionRate, setConversionRate] = useState('2')
  const estimate = estimateRevenue(visitors, customerValue, conversionRate)
  const inputClass = 'mt-2 min-h-11 w-full min-w-0 rounded-lg border border-slate-500 bg-canvas px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400'
  function update(value: string, set: (value: string) => void, maximum?: number) {
    if (value === '') { set(''); return }
    const numeric = Number(value)
    set(!Number.isFinite(numeric) || numeric < 0 ? '' : maximum !== undefined && numeric > maximum ? String(maximum) : value)
  }
  return <section aria-labelledby="revenue-title" className="min-w-0 rounded-2xl border border-blue-400/25 bg-surface p-5 sm:p-6">
    <header className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/15 text-blue-300"><Calculator size={24} aria-hidden="true" /></span><h2 id="revenue-title" className="text-lg font-semibold text-ink">Revenue Calculator</h2></header>
    <p className="mt-3 text-sm leading-6 text-secondary">Estimate the potential revenue from your website traffic.</p>
    <div className="mt-5 space-y-4">
      <div><label htmlFor="monthly-visitors" className="text-xs font-medium text-secondary">Monthly Visitors</label><input id="monthly-visitors" readOnly value={number(visitors)} aria-describedby="visitors-source" className={`${inputClass} text-secondary`} /><p id="visitors-source" className="mt-1 text-[11px] leading-5 text-muted">{demo ? 'Demo users from the illustrative 30-day sample.' : visitors === null ? 'Traffic is unavailable. Estimates need a traffic value.' : 'Users from the displayed 30-day analytics period.'}</p></div>
      <div><label htmlFor="customer-value" className="text-xs font-medium text-secondary">Average Customer Value (USD)</label><input id="customer-value" type="number" inputMode="decimal" min="0.01" step="0.01" value={customerValue} onChange={event => update(event.target.value, setCustomerValue)} aria-invalid={!customerValue || Number(customerValue) <= 0} aria-describedby="revenue-input-help" className={inputClass} /></div>
      <div><label htmlFor="assumed-conversion" className="text-xs font-medium text-secondary">Conversion Rate (%)</label><input id="assumed-conversion" type="number" inputMode="decimal" min="0" max="100" step="0.1" value={conversionRate} onChange={event => update(event.target.value, setConversionRate, 100)} aria-invalid={conversionRate === ''} aria-describedby="revenue-input-help" className={inputClass} /></div>
    </div>
    <p id="revenue-input-help" className="mt-2 text-[11px] leading-5 text-muted">Calculator assumptions, not measured results. Enter a value above $0 and a conversion rate from 0–100%.</p>
    <div className="mt-5 rounded-xl border border-blue-400/30 bg-blue-500/10 p-4" role="status" aria-live="polite" aria-atomic="true">
      <div className="flex items-center gap-3"><Coins size={36} className="shrink-0" style={{ color: '#2F9BFF' }} aria-hidden="true" /><div className="min-w-0 flex-1"><h3 className="text-xs font-medium text-blue-200">Estimated Revenue</h3><p className="mt-2 text-3xl font-semibold tracking-tight text-ink" data-testid="estimated-revenue">{estimate ? currency(estimate.revenue) : '—'}<span className="ml-1 text-xs font-normal text-secondary">/ month</span></p></div></div>
      <p className="mt-2 text-xs leading-5 text-secondary">{estimate ? `${number(visitors)} visitors × ${conversionRate}% ≈ ${number(estimate.customers)} customers × ${currency(Number(customerValue))}` : 'Provide valid assumptions and available traffic to calculate an estimate.'}</p>
    </div>
    <div className="mt-4 grid gap-3 min-[390px]:grid-cols-2">{[10, 20].map((growth, index) => {
      const scenario = estimate?.scenarios[index]
      return <div key={growth} className="min-w-0 rounded-xl border border-line bg-elevated p-3" data-testid={`traffic-scenario-${growth}`}><h3 className="flex items-center gap-1 text-xs font-semibold text-ink"><TrendingUp size={14} className="shrink-0" style={{ color: growth === 10 ? '#22C55E' : '#2F9BFF' }} aria-hidden="true" />+{growth}% Traffic</h3><p className="mt-2 text-[11px] text-secondary">{scenario ? number(scenario.visitors) : '—'} visitors</p><p className="mt-1 break-words text-sm font-semibold text-blue-200">{scenario ? currency(scenario.revenue) : '—'}<span className="text-[10px] font-normal text-muted"> / month</span></p><p className="mt-1 text-[11px] text-emerald-300">{scenario ? `+${currency(scenario.difference)}` : '—'} potential</p></div>
    })}</div>
    <p className="mt-3 text-[11px] text-muted">Hypothetical traffic scenarios, not predictions.</p>
    <div className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-elevated/60 p-3 text-[11px] leading-5 text-muted"><Info size={15} className="mt-0.5 shrink-0 text-blue-300" aria-hidden="true" /><p>Estimate only. Revenue potential is calculated from traffic, the conversion rate, and average customer value entered above. Actual results may vary. For this demo, the default $150 customer value is based on Guzman Tax Accounting’s basic W-2 tax return price.</p></div>
  </section>
}
