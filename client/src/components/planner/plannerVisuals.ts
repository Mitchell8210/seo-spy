import { ChartColumn, Image, Search, Share2, Store } from 'lucide-react'
import type { TaskCategory, TaskPriority } from '../../types/planner'
export const categoryVisuals = {
  Admin: { icon: Store, color: 'border-red-400/30 bg-red-400/10 text-red-200' },
  Content: { icon: Image, color: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  Social: { icon: Share2, color: 'border-violet-400/30 bg-violet-400/10 text-violet-200' },
  Search: { icon: Search, color: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
  Review: { icon: ChartColumn, color: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' },
} satisfies Record<TaskCategory, unknown>
export const urgencyVisuals: Record<TaskPriority, { pill: string; bar: string; badge: string }> = {
  Urgent: { badge: 'border-red-400/40 bg-red-400/15 text-red-300', pill: 'border-red-400/25 bg-red-400/10 text-red-300', bar: 'bg-red-400' },
  Medium: { badge: 'border-amber-400/40 bg-amber-400/15 text-amber-300', pill: 'border-amber-400/25 bg-amber-400/10 text-amber-300', bar: 'bg-amber-400' },
  Low: { badge: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300', pill: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300', bar: 'bg-emerald-400' },
}
export const primaryAction = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-blue-400/40 bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
export const secondaryAction = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-500/60 bg-surface px-3 py-2 text-xs font-semibold text-secondary hover:border-blue-400 hover:text-ink disabled:opacity-50'
