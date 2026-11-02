import { useEffect, useState } from 'react'
import { ArrowUpRight, ImageIcon, WandSparkles } from 'lucide-react'
import { wordpressFix, type FixCandidate } from '../../services/wordpressFix'
import type { FixReviewRequest } from '../../types/fixReview'
import { FixReviewDialog } from '../recommendations/FixReviewDialog'

function candidateReview(candidate: FixCandidate): FixReviewRequest {
  return candidate.review ?? { id: candidate.findingId, title: 'Review this image alternative', category: 'website', source: 'Saved WordPress page evidence',
    businessId: candidate.businessId, reportId: candidate.reportId, findingId: candidate.findingId,
    explanation: candidate.issue, recommendation: 'Confirm whether this image adds essential meaning before changing its alternative text.',
    target: `WordPress media ${candidate.target.mediaId}`, evidence: [candidate.issue],
    evidenceRefs: [{ reportId: candidate.reportId, evidenceId: candidate.evidenceId }], isMock: candidate.isMock }
}
export function RecommendedWordPressFixes({ businessId }: { businessId: string }) {
  const [state, setState] = useState<{ businessId: string; items: FixCandidate[]; error: string } | null>(null)
  const [selected, setSelected] = useState<FixCandidate | null>(null)
  useEffect(() => {
    let active = true
    const refresh = () => { void wordpressFix.candidates(businessId).then(value => {
      if (active) setState({ businessId, items: value.items, error: '' })
    }).catch(error => { if (active) setState({ businessId, items: [], error: error instanceof Error ? error.message : 'Saved recommended fixes could not be loaded.' }) }) }
    refresh(); window.addEventListener('wordpress-fix-updated', refresh)
    return () => { active = false; window.removeEventListener('wordpress-fix-updated', refresh) }
  }, [businessId])
  const current = state?.businessId === businessId ? state : null
  return <section aria-label="Recommended Fixes" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
    <header className="border-b border-line px-5 py-5 sm:px-6"><h2 className="text-xl font-semibold text-ink">Recommended Fixes</h2><p className="mt-2 text-sm text-secondary">Exact saved website opportunities. Review image purpose before making a change.</p></header>
    <div className="p-5 sm:p-6">
      {!current ? <p role="status" className="text-sm text-secondary">Loading saved image recommendations…</p>
        : current.error ? <div className="space-y-3 text-sm text-secondary"><p role="status">{current.error}</p><button type="button" className="min-h-11 rounded-lg border border-line px-3" onClick={() => window.dispatchEvent(new Event('wordpress-fix-updated'))}>Retry saved recommendations</button></div>
        : !current.items.length ? <p className="text-sm text-secondary">No outstanding, exactly bound image-alt opportunities are saved. Completed fixes are listed below.</p>
        : <ul className="grid gap-4 lg:grid-cols-2">{current.items.map(candidate => <li key={`${candidate.reportId}:${candidate.findingId}`} className="flex min-w-0 flex-col rounded-xl border border-line bg-elevated/40 p-4">
          <div className="flex items-start gap-3"><img src={candidate.thumbnailUrl ?? candidate.target.sourceUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-24 shrink-0 rounded-lg border border-line bg-surface object-contain" /><div className="min-w-0"><p className="text-xs font-medium text-blue-300">Website image alternative</p><h3 className="mt-1 break-words font-semibold leading-6 text-ink">{candidate.pageTitle || `Page ${candidate.target.pageId}`}</h3><p className="mt-1 text-xs text-muted">Media {candidate.target.mediaId} · {candidate.target.pageResource} {candidate.target.pageId}</p></div></div>
          <p className="mt-3 text-sm leading-6 text-secondary">{candidate.issue}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ImageIcon size={13} aria-hidden="true" />Current alt: {candidate.target.currentAlt === '' ? '(empty)' : candidate.target.currentAlt}</p>
          <p className="mt-2 break-all text-xs text-muted">Supported capability: {candidate.capability.capability}</p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4"><a href={candidate.target.pageUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-blue-300 hover:underline">View page<ArrowUpRight size={13} aria-hidden="true" /></a>
            <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500" onClick={() => setSelected(candidate)}><WandSparkles size={13} aria-hidden="true" />{candidate.requiresPurposeConfirmation ? 'Review image purpose' : candidate.capability.fixable ? 'Fix with AI' : 'Review Recommendation'}</button></div>
        </li>)}</ul>}
    </div>
    {selected && <FixReviewDialog key={`${selected.reportId}:${selected.findingId}`} review={candidateReview(selected)} capability={selected.capability} candidate={selected} onClose={() => setSelected(null)} />}
  </section>
}
