import { useEffect, useState } from 'react'
import { WandSparkles } from 'lucide-react'
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
  return <div className="mb-4">
      {!current ? <p role="status" className="text-sm text-secondary">Loading saved image recommendations…</p>
        : current.error ? <div className="space-y-3 text-sm text-secondary"><p role="status">{current.error}</p><button type="button" className="min-h-11 rounded-lg border border-line px-3" onClick={() => window.dispatchEvent(new Event('wordpress-fix-updated'))}>Retry saved recommendations</button></div>
        : !current.items.length ? <p className="text-sm text-secondary">No outstanding, exactly bound image-alt opportunities are saved. Completed fixes are listed below.</p>
        : <ul className="space-y-2">{current.items.slice(0, 3).map(candidate => <li key={`${candidate.reportId}:${candidate.findingId}`}>
          <button type="button" aria-haspopup="dialog" aria-label={`${candidate.requiresPurposeConfirmation ? 'Review image purpose' : candidate.capability.fixable ? 'Fix with AI' : 'Review Recommendation'}: ${candidate.pageTitle || `Page ${candidate.target.pageId}`}`}
            className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface p-2 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300" onClick={() => setSelected(candidate)}>
            <img src={candidate.thumbnailUrl ?? candidate.target.sourceUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded border border-line bg-surface object-contain" />
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold leading-4 text-ink">{candidate.pageTitle || `Page ${candidate.target.pageId}`}</span><span className="mt-1 line-clamp-2 text-[10px] leading-4 text-secondary">{candidate.issue}</span></span>
            <WandSparkles size={14} className="shrink-0 text-blue-300" aria-hidden="true" />
          </button>
        </li>)}</ul>}
    {selected && <FixReviewDialog key={`${selected.reportId}:${selected.findingId}`} review={candidateReview(selected)} capability={selected.capability} candidate={selected} onClose={() => setSelected(null)} />}
  </div>
}
