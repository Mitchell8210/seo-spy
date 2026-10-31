import type { Severity } from '../types/dashboard'
export type DashboardCategory = 'website' | 'social' | 'consistency'
export interface DashboardIssue {
  id: string
  title: string
  explanation: string
  severity: Severity
  status: string
  source: string
  category: DashboardCategory
  mode: 'demo' | 'saved'
  destination: string
  recommendation?: { id: string; title: string; explanation: string; status: string }
}
const priority: Record<string, number> = { Critical: 0, Medium: 1, Low: 2 }
export function isActiveOpportunity(status: string) {
  return !['verified', 'resolved', 'passed'].includes(status.toLowerCase())
}
export function selectDashboardOpportunities(issues: DashboardIssue[]) {
  const active = issues.filter(issue => isActiveOpportunity(issue.status))
  const top = Object.fromEntries((['website', 'social', 'consistency'] as const).map(category => [category,
    active.filter(issue => issue.category === category).sort((a, b) => (priority[a.severity] ?? 3) - (priority[b.severity] ?? 3)).slice(0, 3),
  ])) as Record<DashboardCategory, DashboardIssue[]>
  const selected = new Set(Object.values(top).flat().map(issue => `${issue.category}:${issue.id}`))
  const remaining = active.filter(issue => !selected.has(`${issue.category}:${issue.id}`))
    .sort((a, b) => (priority[a.severity] ?? 3) - (priority[b.severity] ?? 3))
  return { top, remaining, path: remaining.filter(issue => issue.recommendation && isActiveOpportunity(issue.recommendation.status)) }
}

export function opportunityDestination(category: DashboardCategory, businessId: string) {
  return category === 'website' ? '/website' : category === 'social'
    ? `/social-media?businessId=${encodeURIComponent(businessId)}` : '/dashboard#consistency-details'
}
