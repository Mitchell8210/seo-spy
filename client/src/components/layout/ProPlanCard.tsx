import { Sparkles } from 'lucide-react'

export function ProPlanCard() {
  return (
    <section aria-label="Future Pro Plan" className="rounded-xl border border-blue-400/15 bg-elevated p-4 shadow-md shadow-black/10">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="flex size-8 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-400/10 text-blue-300"><Sparkles size={17} aria-hidden="true" /></span>Pro Plan</h2>
      <p className="mt-2 text-xs leading-6 text-secondary">Grow your business with AI-powered insights.</p>
      <button type="button" disabled className="mt-3 min-h-11 w-full cursor-not-allowed rounded-lg border border-blue-400/20 bg-blue-400/5 px-3 py-2 text-xs font-semibold text-secondary">Upgrade Plan</button>
      <p className="mt-2 text-xs text-muted">Coming later</p>
    </section>
  )
}
