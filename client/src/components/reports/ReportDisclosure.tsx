import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function ReportDisclosure({ title, isIssue, children, emphasized = false }: { title: string; isIssue: boolean; children: ReactNode; emphasized?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const disclosureLabel = expanded ? 'Hide Details' : isIssue ? 'Fix Now' : 'View Details'
  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={`${disclosureLabel}: ${title}${!expanded && isIssue ? ' — review remediation details' : ''}`}
        onClick={() => setExpanded((open) => !open)}
        className={emphasized
          ? `mt-4 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-sm font-semibold ${isIssue && !expanded ? 'border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-950/25 hover:bg-blue-700' : isIssue ? 'border-blue-400/30 bg-blue-400/10 text-blue-200 hover:bg-blue-400/15' : 'border-blue-400/20 bg-blue-400/5 text-blue-300 hover:bg-blue-400/15'}`
          : 'mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-line px-3 text-xs font-medium text-blue-300 hover:bg-elevated'}
      >
        {disclosureLabel}
        <ChevronDown size={15} aria-hidden="true" className={`shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <div id={detailsId} hidden={!expanded} className="mt-4 space-y-4 border-t border-line pt-4 text-xs leading-6 text-secondary">
        {children}
      </div>
    </>
  )
}
