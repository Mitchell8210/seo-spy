import { useState } from 'react'
import { StatusBadge } from '../common/StatusBadge'

export function PlanSettings() {
  const [message, setMessage] = useState('')
  return (
    <>
      <div className="mt-5 flex flex-col gap-5 rounded-xl border border-amber-300/15 bg-elevated p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h3 className="text-xl font-semibold text-ink">Free Plan</h3><StatusBadge label="Current plan · Demo" tone="blue" /></div><p className="mt-3 max-w-lg text-sm leading-7 text-secondary">You're currently on the Free Plan. Upgrade to unlock more AI tools and features.</p><p className="mt-3 text-xs leading-6 text-muted">Product preview only. Plans and payments are not available in this demo.</p></div>
        <button type="button" onClick={() => setMessage('Plans coming soon. No billing or subscription changes were made.')} className="min-h-11 shrink-0 self-start rounded-lg border border-blue-400/40 px-5 text-sm font-semibold text-blue-300 hover:bg-blue-400/10 sm:self-center">View Plans</button>
      </div>
      <p role="status" className="mt-3 text-sm leading-6 text-blue-300">{message}</p>
    </>
  )
}
