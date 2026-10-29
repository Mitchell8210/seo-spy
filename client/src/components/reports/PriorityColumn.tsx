import type { ReactNode } from 'react'
import { ArrowDown, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { Severity } from '../../types/dashboard'
import { findingStatuses } from '../../utils/findingStatus'

const accents = {
  Critical: { edge: 'border-t-red-400/70', tile: 'border-red-400/25 bg-red-400/10', count: 'bg-red-400/10' },
  Medium: { edge: 'border-t-amber-300/70', tile: 'border-amber-300/25 bg-amber-300/10', count: 'bg-amber-300/10' },
  Low: { edge: 'border-t-emerald-400/70', tile: 'border-emerald-400/25 bg-emerald-400/10', count: 'bg-emerald-400/10' },
  Passed: { edge: 'border-t-blue-400/70', tile: 'border-blue-400/25 bg-blue-400/10', count: 'bg-blue-400/10' },
  Verified: { edge: 'border-t-blue-400/70', tile: 'border-blue-400/25 bg-blue-400/10', count: 'bg-blue-400/10' },
}

const icons = { Critical: TriangleAlert, Medium: CircleAlert, Low: ArrowDown, Passed: CircleCheck, Verified: CircleCheck }

export function PriorityColumn({ headingId, label, description, severity, count, children, emphasized = false }: { headingId: string; label: string; description: string; severity: Severity; count: number; children: ReactNode; emphasized?: boolean }) {
  const Icon = icons[severity]
  const color = findingStatuses[severity].icon
  return (
    <section aria-labelledby={headingId} className={`min-w-0 rounded-lg border border-line bg-elevated p-3 ${emphasized ? `border-t-[3px] ${accents[severity].edge} shadow-lg shadow-black/10` : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id={headingId} className={`flex min-w-0 items-center gap-2 text-sm font-semibold ${color}`}>{emphasized ? <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${accents[severity].tile}`}><Icon size={18} aria-hidden="true" /></span> : <Icon size={16} className="shrink-0" aria-hidden="true" />}{label}</h3>
        <span className={`shrink-0 text-sm font-semibold ${color} ${emphasized ? `flex size-7 items-center justify-center rounded-lg ring-1 ring-current/15 ${accents[severity].count}` : ''}`} aria-label={`${count} items`}>{count}</span>
      </div>
      <p className={`mb-4 text-xs leading-5 text-muted ${emphasized ? 'mt-3 min-h-10 border-b border-line pb-4' : ''}`}>{description}</p>
      <ul className="space-y-3">{children}</ul>
      {count === 0 && <p className="py-3 text-xs leading-6 text-muted">No items in this group.</p>}
    </section>
  )
}
