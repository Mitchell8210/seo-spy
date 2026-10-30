import { useState } from 'react'
import type { RefObject } from 'react'

export function FindingActions({ fixRef, hasRecommendation, target = 'website', live = false }: { fixRef: RefObject<HTMLHeadingElement | null>; hasRecommendation: boolean; target?: 'website' | 'account'; live?: boolean }) {
  const [actionMessage, setActionMessage] = useState('')
  return (
          <div className="border-t border-line pt-4">
            <h5 className="font-semibold text-ink">Available actions</h5>
            <p className="mt-1 text-muted">{live ? `Recommendations are for review. Automatic ${target} changes are unavailable.` : `Demo controls only. AI fixing is unavailable; no ${target} changes will be made.`}</p>
            <div className="mt-3 flex flex-col gap-2">
              <button type="button" disabled className="min-h-11 rounded-md bg-blue-700 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">Fix with AI</button>
              <button type="button" disabled={!hasRecommendation} onClick={() => {
                fixRef.current?.focus()
                fixRef.current?.scrollIntoView({ block: 'nearest' })
                setActionMessage(live ? 'The suggested steps are shown above. No changes have been applied.' : 'The existing suggested fix is shown above. This demo does not apply changes.')
              }} className="min-h-11 rounded-md border border-line px-3 py-2 font-medium text-blue-300 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60">View Fix Steps</button>
              <button type="button" onClick={() => setActionMessage(`Selected for manual review in this view only. No ${target} changes have been made.`)} className="min-h-11 rounded-md border border-line px-3 py-2 font-medium text-secondary hover:bg-elevated">Review Manually</button>
            </div>
            <p role="status" className="mt-2 text-blue-300">{actionMessage}</p>
          </div>
  )
}
