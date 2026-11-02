import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import type { FixReviewRequest } from '../../types/fixReview'

const primary = 'min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
const secondary = 'min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-medium text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300'

export function FixReviewDialog({ review, onClose }: { review: FixReviewRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(), descriptionId = useId(), notesId = useId()
  const [step, setStep] = useState<'review' | 'confirm' | 'confirmed'>('review')
  const [notes, setNotes] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])
  const category = { website: 'Website', social: 'Social Media', consistency: 'Business Consistency' }[review.category]
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose() }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/70">
    <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
      <div><p className="text-xs font-semibold text-blue-300">Fix with AI · {category}</p><h2 id={titleId} className="mt-2 text-xl font-semibold">{step === 'review' ? 'Review recommended fix' : step === 'confirm' ? 'Confirm your selection' : 'Selection confirmed'}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-secondary">{step === 'confirmed' ? 'Your choice is held only while this review is open. No changes have been applied.' : 'Review the saved recommendation before deciding how to proceed.'}</p></div>
      <button type="button" aria-label="Close fix review" onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300"><X size={20} /></button>
    </div>
    <div className="space-y-5 p-5 text-sm leading-6 [overflow-wrap:anywhere] sm:p-6">
      <ol aria-label="Fix review progress" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
        {(['review', 'confirm', 'confirmed'] as const).map((item, index) => <li key={item} aria-current={step === item ? 'step' : undefined} className={step === item ? 'font-semibold text-blue-300' : ''}>{index + 1}. {['Review', 'Confirm', 'Next steps'][index]}</li>)}
      </ol>
      <section><h3 className="font-semibold text-ink">{review.title}</h3><p className="mt-1 text-xs text-muted">{review.source}{review.isMock ? ' · Mock recommendation' : ''}</p></section>
      {step === 'review' && <>
        <section><h3 className="font-semibold">Why this was recommended</h3><p className="mt-1 whitespace-pre-wrap text-secondary">{review.explanation}</p></section>
        <section><h3 className="font-semibold">Supporting evidence</h3>
          {review.evidence?.length ? <ul className="mt-1 space-y-2 text-secondary">{review.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="mt-1 text-secondary">Review the saved report for the supporting observations.</p>}
          {!!review.evidenceRefs?.length && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer py-2">Saved evidence references</summary><ul className="space-y-2">{review.evidenceRefs.map(ref => <li key={`${ref.reportId}:${ref.evidenceId}`}>Report: {ref.reportId}<br />Evidence: {ref.evidenceId}</li>)}</ul></details>}
        </section>
        <dl className="grid grid-cols-2 gap-4 rounded-lg border border-line p-4"><div><dt className="text-muted">Effort</dt><dd>{review.effort && review.effort !== 'unknown' ? review.effort : 'Not assessed'}</dd></div><div><dt className="text-muted">Risk</dt><dd>{review.risk && review.risk !== 'unknown' ? review.risk : 'Not assessed'}</dd></div></dl>
      </>}
      <section className="rounded-xl border border-blue-400/25 bg-blue-400/5 p-4"><h3 className="font-semibold">Recommended action</h3><p className="mt-2 whitespace-pre-wrap text-secondary">{review.recommendation || 'No saved recommendation is available for this issue.'}</p><p className="mt-3 text-xs text-muted">Affected area: {review.target || category}. An exact editable target and before/after change have not been prepared.</p></section>
      {step === 'review' && <>
        {!!review.verificationSteps?.length && <section><h3 className="font-semibold">How to check the result</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-secondary">{review.verificationSteps.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
        {review.manualFallback && <section><h3 className="font-semibold">Manual option</h3><p className="mt-1 text-secondary">{review.manualFallback}</p></section>}
        <div><label htmlFor={notesId} className="font-semibold">Instructions for this fix <span className="font-normal text-muted">(optional)</span></label><textarea id={notesId} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-sm text-ink focus:outline-2 focus:outline-blue-300" placeholder="Add context or preferences for the proposed work." /></div>
      </>}
      {step !== 'review' && notes.trim() && <section><h3 className="font-semibold">Your instructions</h3><p className="mt-1 whitespace-pre-wrap text-secondary">{notes}</p></section>}
      <section className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-secondary"><h3 className="font-semibold text-amber-200">{step === 'confirmed' ? 'Waiting for backend integration' : 'Before a fix can be applied'}</h3><p className="mt-2">{review.category === 'social' ? 'Social changes need a supported account action. WordPress access cannot publish or change Facebook content.' : 'The backend must prepare a supported change for an exact target and provide an authorized connection.'} You will need to review and approve that change separately before it is applied.</p><p className="mt-2 text-xs text-muted">This review does not run AI, modify your website or account, or verify a fix.</p></section>
      {step === 'confirm' && <label className="flex items-start gap-3 rounded-lg border border-line p-4"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-500" /><span>I want to proceed with this recommendation. I understand this selection is temporary and does not apply or authorize an exact change.</span></label>}
      {step === 'confirmed' && <p role="status" className="flex items-start gap-2 text-blue-200"><Check size={20} className="mt-1 shrink-0" />Recommendation selected for this review. Backend execution is not connected yet.</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-3 border-t border-line p-5 sm:px-6">
      {step === 'review' ? <><button type="button" className={secondary} onClick={onClose}>Cancel</button><button type="button" className={primary} disabled={!review.recommendation?.trim()} onClick={() => setStep('confirm')}>Continue to confirmation</button></> : step === 'confirm' ? <><button type="button" className={secondary} onClick={() => { setAcknowledged(false); setStep('review') }}>Back to review</button><button type="button" className={primary} disabled={!acknowledged} onClick={() => setStep('confirmed')}>Confirm selection</button></> : <button type="button" className={primary} onClick={onClose}>Done</button>}
    </div>
  </dialog>, document.body)
}
