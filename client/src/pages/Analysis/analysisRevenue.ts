export type TrafficMetric = 'users' | 'sessions' | 'conversions'
export interface AnalyticsData {
  source: 'demo' | 'unavailable'
  period: string
  daily: { day: number; users: number; sessions: number; conversions: number }[]
  channels: { label: string; value: number }[]
  devices: { label: string; value: number }[]
  pages: { path: string; users: number }[]
}
export function analyticsTotals(data: AnalyticsData) {
  if (data.source === 'unavailable' || data.daily.length === 0) return { users: null, sessions: null, conversions: null, rate: null }
  const totals = data.daily.reduce((sum, day) => ({ users: sum.users + day.users, sessions: sum.sessions + day.sessions, conversions: sum.conversions + day.conversions }), { users: 0, sessions: 0, conversions: 0 })
  return { ...totals, rate: totals.users ? totals.conversions / totals.users * 100 : null }
}
export function estimateRevenue(visitors: number | null, customerValue: string, rate: string) {
  const value = Number(customerValue), percent = Number(rate)
  if (visitors === null || !Number.isFinite(visitors) || visitors < 0 || !customerValue.trim() || !rate.trim()
    || !Number.isFinite(value) || value <= 0 || !Number.isFinite(percent) || percent < 0 || percent > 100) return null
  const customers = visitors * percent / 100
  const revenue = customers * value
  if (!Number.isFinite(revenue * 1.2)) return null
  return { customers, revenue, scenarios: [10, 20].map(growth => {
    const projectedVisitors = visitors * (1 + growth / 100)
    const projectedRevenue = projectedVisitors * percent / 100 * value
    return { growth, visitors: projectedVisitors, revenue: projectedRevenue, difference: projectedRevenue - revenue }
  }) }
}
export const number = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
export const currency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
