import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import type { FixReviewRequest } from '../../types/fixReview'
import { wordpressFix, type FixCapability, type AltGeneration, type AltProposal, type AltVerification } from '../../services/wordpressFix'

const primary = 'min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
const secondary = 'min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-medium text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300'

export function FixReviewDialog({ review, capability, onClose }: { review: FixReviewRequest; capability?: FixCapability | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(), descriptionId = useId(), notesId = useId()
  const [step, setStep] = useState<'review' | 'confirm' | 'confirmed'>('review')
  const [notes, setNotes] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [generation, setGeneration] = useState<AltGeneration | null>(capability?.savedGeneration ?? null)
  const [text, setText] = useState(capability?.savedGeneration?.output.altText ?? '')
  const [proposal, setProposal] = useState<AltProposal | null>(null)
  const [outcome, setOutcome] = useState<Record<string, unknown> | null>(null)
  const [verification, setVerification] = useState<AltVerification | null>(null)
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const supported = capability?.fixable === true && !!review.businessId
  const evidence = capability?.evidence
  const target = evidence?.target
  const businessId = review.businessId ?? ''
  async function run(label: string, work: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(label); setError('')
    try { await work() } catch (failure) { setError(failure instanceof Error ? failure.message : 'The operation failed. No automatic retry was made.') }
    finally { busyRef.current = false; setBusy('') }
  }
  const generate = () => run('Preparing AI proposal…', async () => {
    const value = await wordpressFix.generate(businessId, evidence!.id, notes)
    setGeneration(value); setText(value.output.altText ?? ''); setProposal(null); setAcknowledged(false)
  })
  const prepare = () => run('Preparing exact change…', async () => {
    const value = await wordpressFix.propose(businessId, generation!.id, text)
    setProposal(value); setAcknowledged(false); setStep('confirm')
  })
  const apply = () => run('Applying the approved change…', async () => {
    setStep('confirmed')
    try { setOutcome(await wordpressFix.apply(businessId, proposal!)) }
    catch {
      // Inspect the saved journal once. This GET cannot resend a WordPress write.
      const saved = await wordpressFix.read(businessId, proposal!.id)
      setOutcome(saved.outcome ?? { status: saved.executionStarted ? 'outcome_unknown' : 'not_dispatched', message: 'No successful response. Inspect the saved operation; no retry was made.' })
    }
  })
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
      <div><p className="text-xs font-semibold text-blue-300">{supported ? 'Fix with AI' : 'Review Recommendation'} · {category}</p><h2 id={titleId} className="mt-2 text-xl font-semibold">{step === 'review' ? 'Review recommended fix' : step === 'confirm' ? 'Confirm your selection' : 'Verify the result'}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-secondary">{step === 'confirmed' ? 'Inspect the saved execution receipt and verify the stored and public result.' : 'Review the saved recommendation before deciding how to proceed.'}</p></div>
      <button type="button" aria-label="Close fix review" onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300"><X size={20} /></button>
    </div>
    <div className="space-y-5 p-5 text-sm leading-6 [overflow-wrap:anywhere] sm:p-6">
      <ol aria-label="Fix review progress" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
        {(['review', 'confirm', 'confirmed'] as const).map((item, index) => <li key={item} aria-current={step === item ? 'step' : undefined} className={step === item ? 'font-semibold text-blue-300' : ''}>{index + 1}. {['Review', 'Confirm', 'Verify'][index]}</li>)}
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
      <section className="rounded-xl border border-blue-400/25 bg-blue-400/5 p-4"><h3 className="font-semibold">Recommended action</h3><p className="mt-2 whitespace-pre-wrap text-secondary">{review.recommendation || 'No saved recommendation is available for this issue.'}</p><p className="mt-3 text-xs text-muted">Affected area: {target ? `WordPress media ${target.mediaId} · alt_text` : review.target || category}.{!supported && ' No supported editable target has been established.'}</p></section>
      {supported && target && <section className="space-y-2 rounded-lg border border-line p-4"><h3 className="font-semibold">Exact WordPress resource</h3>
        <p>Media {target.mediaId} · {target.pageResource} {target.pageId}</p><p className="break-all text-secondary">{target.pageUrl}</p>
        <a href={target.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-blue-300">View the source image</a>
        <p className="text-xs text-muted">No thumbnail pixels were collected. Image retrieval and visual Muse input are not enabled.</p>
        <p className="text-secondary">Confirmed image context: {evidence?.verifiedDescription || evidence?.purpose}</p>
        <p className="text-xs text-muted">{evidence?.descriptionProvenance}. Context expires {evidence?.expiresAt}.</p>
        <p>Alt text recorded at review: <span className="whitespace-pre-wrap">{target.currentAlt === '' ? '(empty)' : target.currentAlt}</span></p>
      </section>}
      {step === 'review' && <>
        {!!review.verificationSteps?.length && <section><h3 className="font-semibold">How to check the result</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-secondary">{review.verificationSteps.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
        {review.manualFallback && <section><h3 className="font-semibold">Manual option</h3><p className="mt-1 text-secondary">{review.manualFallback}</p></section>}
        <div><label htmlFor={notesId} className="font-semibold">Instructions for this fix <span className="font-normal text-muted">(optional)</span></label><textarea id={notesId} maxLength={2000} value={notes} onChange={event => { setNotes(event.target.value); setGeneration(null); setProposal(null); setAcknowledged(false) }} rows={3} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-sm text-ink focus:outline-2 focus:outline-blue-300" placeholder="Add context or preferences for the proposed work." /></div>
      </>}
      {step !== 'review' && notes.trim() && <section><h3 className="font-semibold">Your instructions</h3><p className="mt-1 whitespace-pre-wrap text-secondary">{notes}</p></section>}
      {supported && step === 'review' && <section className="space-y-3"><button type="button" className={primary} disabled={!!busy} onClick={generate}>Generate AI proposal</button>
        {generation && <><p className="text-xs text-muted">{generation.isMock ? 'Mock AI proposal · local fixture · zero paid calls' : 'Live Meta Muse proposal'} · {generation.output.reason}</p>
          {generation.output.status === 'insufficient_evidence' ? <p role="status">Insufficient image evidence. No executable proposal was prepared.</p> : <>
            <p className="whitespace-pre-wrap text-secondary">AI-proposed alt text: {generation.output.altText === '' ? '(empty, decorative)' : generation.output.altText}</p>
            <label className="block font-semibold">Proposed alt text<textarea aria-label="Proposed alt text" value={text} maxLength={300} rows={3} onChange={event => { setText(event.target.value); setProposal(null); setAcknowledged(false) }} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-sm text-ink focus:outline-2 focus:outline-blue-300" /></label>
            <p className="text-xs text-muted">Edits must stay within the confirmed image description. Continuing creates a fresh proposal and approval hash.</p>
          </>}
        </>}
      </section>}
      <section className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-secondary"><h3 className="font-semibold text-amber-200">Before a fix can be applied</h3>
        <p className="mt-2">{supported ? 'Review and explicitly approve the exact alt_text update. All other WordPress fields remain outside this workflow.' : review.category === 'social' ? 'Facebook recommendations remain manual. WordPress access cannot publish or change Facebook content.' : capability?.reason || 'A trusted local operator must establish an exact current image target and connect this browser with a one-use session link. This recommendation remains informational.'}</p>
        <p className="mt-2 text-xs text-muted">{supported ? `${capability?.writesEnabled ? 'The write gate is enabled for this operator process.' : 'WordPress writes are disabled. Proposals can be reviewed, but Apply is blocked.'} No score or ranking improvement is established.` : 'No AI generation, website change or verification is triggered by this informational review.'}</p>
        {capability?.limitations.map(item => <p key={item} className="mt-2 text-xs text-muted">{item}</p>)}
      </section>
      {step === 'confirm' && proposal && <>
        <section className="space-y-2 rounded-lg border border-line p-4"><h3 className="font-semibold">{proposal.restorationOf ? 'Restoration proposal' : 'Exact before/after update'}</h3><p>WordPress media {proposal.resourceId} · alt_text</p><p>Before: <span className="whitespace-pre-wrap">{proposal.before.altText || '(empty)'}</span></p><p>After: <span className="whitespace-pre-wrap">{proposal.changes.altText || '(empty)'}</span></p><p className="text-xs text-muted">Proposal: {proposal.id}<br />Hash: {proposal.hash}<br />Expires: {proposal.expiresAt}</p></section>
        <label className="flex items-start gap-3 rounded-lg border border-line p-4"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-500" /><span>I approve this exact media resource and before/after alt_text update. Apply will execute it once.</span></label>
      </>}
      {step === 'confirmed' && proposal && <section className="space-y-3"><p role="status" className="flex items-start gap-2 text-blue-200"><Check size={20} className="mt-1 shrink-0" />{verification?.status ?? String(outcome?.status ?? 'Waiting for saved receipt')}</p>
        <p className="text-xs text-muted">Proposal receipt: {proposal.id}</p><pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-line p-3 text-xs">{JSON.stringify(verification ?? outcome, null, 2)}</pre>
        {outcome?.status === 'applied' && <><button type="button" className={secondary} disabled={!!busy} onClick={() => run('Verifying stored and public values…', async () => { setVerification(await wordpressFix.verify(businessId, proposal.id)) })}>Verify stored and public result</button>
          {!proposal.restorationOf && outcome.verification === 'verified_stored_fields' && <button type="button" className={secondary} disabled={!!busy} onClick={() => run('Preparing separately approved restoration…', async () => { setProposal(await wordpressFix.restore(businessId, proposal.id)); setOutcome(null); setVerification(null); setAcknowledged(false); setStep('confirm') })}>Prepare restoration</button>}</>}
        {outcome?.status !== 'applied' && <p className="text-secondary">Stop and inspect the saved receipt. Uncertain outcomes require explicit operator reconciliation; no automatic retry or rollback is available.</p>}
      </section>}
      {(busy || error) && <p role="status" className="whitespace-pre-wrap text-secondary">{busy || error}</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-3 border-t border-line p-5 sm:px-6">
      {step === 'review' ? <><button type="button" className={secondary} onClick={onClose}>{supported ? 'Cancel' : 'Done'}</button>{supported && <button type="button" className={primary} disabled={!!busy || generation?.output.status !== 'proposed' || text === target?.currentAlt} onClick={prepare}>Continue to confirmation</button>}</> : step === 'confirm' ? <>{!proposal?.restorationOf && <button type="button" className={secondary} disabled={!!busy} onClick={() => { setAcknowledged(false); setStep('review') }}>Back to review</button>}<button type="button" className={primary} disabled={!!busy || !acknowledged || !capability?.writesEnabled || !proposal || Date.parse(proposal.expiresAt) <= now} onClick={apply}>Approve &amp; Apply</button></> : <button type="button" className={primary} onClick={onClose}>Done</button>}
    </div>
  </dialog>, document.body)
}
