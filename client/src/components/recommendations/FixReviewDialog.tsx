import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import type { FixReviewRequest } from '../../types/fixReview'
import { wordpressFix, fixReviewState, fixStatusLabel, customerFixReady, customerFixApplyReady, customerFixSetupMessage, customerFixReviewMessage, notifyWordPressFixChanged, WordPressFixError, type FixCapability, type FixCandidate, type AltGeneration, type AltProposal, type AltVerification, type AltEvidence } from '../../services/wordpressFix'

const primary = 'min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
const secondary = 'min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-medium text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300'

export function FixReviewDialog({ review, capability: initialCapability, candidate, onClose }: { review: FixReviewRequest; capability?: FixCapability | null; candidate?: FixCandidate; onClose: () => void }) {
  const [capability, setCapability] = useState(initialCapability)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(), descriptionId = useId()
  const initial = fixReviewState(capability, candidate ? !candidate.isMock : review.isMock === false)
  const supersededAbstention = !!candidate && capability?.customerGenerationPolicy === 'page-context-v1'
    && initial.generation?.output.status === 'insufficient_evidence' && initial.generation.output.schemaVersion !== 'wordpress-alt-output-v2'
  const [step, setStep] = useState<'review' | 'confirm' | 'confirmed'>(initial.step === 'confirmed' ? 'confirmed' : 'review')
  const [generation, setGeneration] = useState<AltGeneration | null>(supersededAbstention ? null : initial.generation)
  const [text, setText] = useState(initial.text)
  const [proposal, setProposal] = useState<AltProposal | null>(initial.proposal)
  const [outcome, setOutcome] = useState<Record<string, unknown> | null>(initial.outcome)
  const [verification, setVerification] = useState<AltVerification | null>(initial.verification)
  const [verifying, setVerifying] = useState(false)
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false), generationStarted = useRef(false)
  const [error, setError] = useState('')
  const reviewedContext = capability?.evidence ?? capability?.purposeReview
  const [purposeReviewed, setPurposeReviewed] = useState(!candidate?.requiresPurposeConfirmation && (supersededAbstention || initial.generation?.output.status !== 'insufficient_evidence'))
  const [purpose, setPurpose] = useState<AltEvidence['purpose']>(reviewedContext?.purpose ?? 'unknown')
  const [description, setDescription] = useState(reviewedContext?.verifiedDescription ?? '')
  const [language, setLanguage] = useState<'es' | 'en' | ''>(reviewedContext?.proposalContext?.language ?? candidate?.pageLanguage ?? '')
  const [essentialTerms, setEssentialTerms] = useState(reviewedContext?.proposalContext?.requiredTerms.join(', ') ?? '')
  const supported = (capability?.fixable === true || !!capability?.workflow?.proposal) && !!review.businessId
  const evidence = capability?.evidence
  const target = evidence?.target ?? candidate?.target
  const businessId = review.businessId ?? ''
  const ready = customerFixReady(capability), applyReady = customerFixApplyReady(capability)
  const run = useCallback(async (label: string, work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(label); setError('')
    try { await work() }
    catch (failure) { if (failure instanceof Error && failure.message === customerFixReviewMessage) setPurposeReviewed(false); setError(failure instanceof WordPressFixError && failure.status === 401 ? 'Your session has expired. Reconnect your account to continue. No changes were made.' : failure instanceof Error ? failure.message : 'This fix could not be completed. Your text has been preserved.') }
    finally { busyRef.current = false; setBusy('') }
  }, [])
  useEffect(() => {
    if (step !== 'review' || generation || !supported || !purposeReviewed || !ready || !evidence || generationStarted.current) return
    generationStarted.current = true
    void run('Preparing your AI suggestion…', async () => {
      const value = await wordpressFix.customerGenerate(businessId, evidence.id)
      setGeneration(value); setText(value.output.altText ?? ''); setProposal(null)
      if (value.output.status === 'insufficient_evidence') setPurposeReviewed(false)
      notifyWordPressFixChanged()
    })
  }, [businessId, evidence, generation, purposeReviewed, ready, run, step, supported])
  const confirmPurpose = () => run('Confirming image purpose…', async () => {
    if (!candidate || !language) return
    const confirmed = await wordpressFix.confirmPurpose(businessId, candidate, purpose, description, language, essentialTerms.split(',').map(value => value.trim()).filter(Boolean))
    if (purpose === 'decorative') {
      setCapability({ ...candidate.capability, fixable: false, evidence: confirmed, reason: 'This image is decorative or fully redundant. Its empty alternative is retained; no fix is needed.' })
      setPurposeReviewed(true); notifyWordPressFixChanged(); return
    }
    const updated = (await wordpressFix.candidates(businessId)).items.find(item => item.reportId === candidate.reportId && item.findingId === candidate.findingId)
    if (!updated) throw new Error('This recommendation has changed. Refresh the Dashboard before continuing.')
    generationStarted.current = false
    setGeneration(null); setProposal(null); setText('')
    setCapability(updated.capability); setPurposeReviewed(true); notifyWordPressFixChanged()
  })
  const apply = () => {
    // Capture the exact visible edit at the explicit approval click. No edits or duplicate clicks while in flight.
    const approvedText = text
    void run('Applying your change…', async () => {
      if (!generation || !target || !applyReady) throw new Error(customerFixSetupMessage)
      const exact = await wordpressFix.propose(businessId, generation.id, approvedText)
      if (exact.resourceId !== target.mediaId || exact.before.altText !== target.currentAlt || exact.changes.altText !== approvedText || Date.parse(exact.expiresAt) <= Date.now()) throw new Error('The image changed while you were reviewing it. Refresh this recommendation before approving again.')
      setProposal(exact); setStep('confirm')
      try {
        const result = await wordpressFix.customerApply(businessId, exact)
        setOutcome(result.outcome); setVerification(result.verification ?? null); setStep('confirmed')
        if (result.outcome.status === 'applied' && !result.verification) {
          setVerifying(true)
          // Show the saved write immediately; public HTML verification cannot hold the result screen open.
          void wordpressFix.verify(businessId, exact.id).then(setVerification).catch(() => {
            setError('Your change was saved. Public verification is pending; check the saved result before taking another action.')
          }).finally(() => { setVerifying(false); notifyWordPressFixChanged() })
        }
      } catch (failure) {
        // One read of the saved journal cannot resend an uncertain write.
        const saved = await wordpressFix.reconcileFailedApply(businessId, exact)
        if (saved.executionStarted || saved.outcome) {
          setOutcome(saved.outcome ?? { status: 'outcome_unknown' }); setStep('confirmed')
        } else setStep('review')
        throw failure
      } finally { notifyWordPressFixChanged() }
    })
  }
  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    element.showModal(); document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus() }
  }, [])
  const category = { website: 'Website', social: 'Social Media', consistency: 'Business Consistency' }[review.category]
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/70">
    <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
      <div><p className="text-xs font-semibold text-blue-300">{supported ? 'Fix with AI' : 'Review Recommendation'} · {category}</p><h2 id={titleId} className="mt-2 text-xl font-semibold">{step === 'review' ? 'Review recommended fix' : step === 'confirm' ? 'Applying your change' : 'Verify the result'}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-secondary">{step === 'confirmed' ? 'Your saved result and independent verification.' : 'Review or edit the suggestion, then approve the exact change.'}</p></div>
      <button type="button" aria-label="Close fix review" disabled={!!busy} onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300"><X size={20} /></button>
    </div>
    <div className="space-y-5 p-5 text-sm leading-6 [overflow-wrap:anywhere] sm:p-6">
      <ol aria-label="Fix review progress" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
        {(['review', 'confirm', 'confirmed'] as const).map((item, index) => <li key={item} aria-current={step === item ? 'step' : undefined} className={step === item ? 'font-semibold text-blue-300' : ''}>{index + 1}. {['Review', 'Apply', 'Verify'][index]}</li>)}
      </ol>
      <section><h3 className="font-semibold text-ink">{review.title}</h3><p className="mt-1 text-xs text-muted">{review.source}{review.isMock ? ' · Mock recommendation' : ''}</p></section>
      {step === 'review' && <section><p className="whitespace-pre-wrap text-secondary">{review.explanation}</p></section>}
      {target && <section className="space-y-2 rounded-lg border border-line p-4">
        <h3 className="font-semibold">{candidate?.pageTitle || 'Website image'}</h3>
        {candidate && <img src={candidate.thumbnailUrl ?? target.sourceUrl} alt="" referrerPolicy="no-referrer" className="max-h-64 w-full rounded-lg bg-elevated object-contain" />}
        <p className="text-xs text-muted">WordPress media {target.mediaId} · Page {target.pageId}</p>
        <a href={target.pageUrl} target="_blank" rel="noreferrer" className="break-all text-blue-300">View affected page</a>
        {evidence?.verifiedDescription && <p className="text-secondary">{evidence.verifiedDescription}</p>}
        <p>{step === 'confirmed' ? 'Alt text before this fix:' : 'Current alt text:'} <span className="whitespace-pre-wrap">{target.currentAlt === '' ? '(empty)' : target.currentAlt}</span></p>
      </section>}
      {candidate && !purposeReviewed && step === 'review' && <section className="space-y-3 rounded-lg border border-line p-4">
        <h3 className="font-semibold">Review image purpose</h3>
        <p className="text-secondary">Empty alt text is not automatically a defect. Review the image and nearby page text before confirming its purpose.</p>
        <label className="block font-semibold">Image purpose<select aria-label="Image purpose" value={purpose} onChange={event => setPurpose(event.target.value as AltEvidence['purpose'])} className="mt-2 block min-h-11 w-full rounded-lg border border-line bg-elevated p-3 text-ink">
          <option value="unknown">Not yet established</option><option value="informative">Informative — adds essential meaning</option><option value="decorative">Decorative or fully redundant — keep empty alt</option>
        </select></label>
        <label className="block font-semibold">Reviewed image description<textarea aria-label="Reviewed image description" disabled={!!busy} maxLength={500} rows={3} value={description} onChange={event => setDescription(event.target.value)} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-ink" /></label>
        <p className="text-xs text-muted">Describe only content you can reliably verify.</p>
        <label className="block font-semibold">Page and description language<select aria-label="Page and description language" value={language} onChange={event => setLanguage(event.target.value as 'es' | 'en' | '')} className="mt-2 block min-h-11 w-full rounded-lg border border-line bg-elevated p-3 text-ink"><option value="">Review and choose language</option><option value="es">Spanish</option><option value="en">English</option></select></label>
        {purpose === 'informative' && language === 'es' && <label className="block font-semibold">Essential Spanish words<textarea aria-label="Essential Spanish words" disabled={!!busy} maxLength={200} rows={2} value={essentialTerms} onChange={event => setEssentialTerms(event.target.value)} placeholder="Comma-separated words from the reviewed description" className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-ink" /></label>}
        <button type="button" className={primary} disabled={!!busy || purpose === 'unknown' || !language} onClick={confirmPurpose}>Confirm image purpose</button>
      </section>}
      {supported && step === 'review' && <section className="space-y-3">
        {!(generation ? applyReady : ready) && <p role="status" className="text-secondary">{customerFixSetupMessage}</p>}
        {generation && <><p className="text-xs text-muted">{generation.isMock ? 'Mock AI suggestion · no paid calls' : 'Live Meta Muse suggestion · based on reviewed image context'}</p>
          {generation.output.status === 'insufficient_evidence' ? <p role="status">We need more reliable image context before suggesting a change.</p> : <>
            <label className="block font-semibold">Proposed alt text<textarea aria-label="Proposed alt text" disabled={!!busy} value={text} maxLength={300} rows={3} onChange={event => { setText(event.target.value); setProposal(null) }} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-sm text-ink focus:outline-2 focus:outline-blue-300" /></label>
            <p className="text-xs text-muted">Only this image's alternative text will change.</p>
          </>}
        </>}
      </section>}
      {!supported && purposeReviewed && <section className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-secondary"><p>{capability?.reason || review.recommendation || 'This recommendation needs manual review. No supported website edit is available.'}</p></section>}
      {step !== 'review' && proposal && <section className="space-y-2 rounded-lg border border-line p-4"><h3 className="font-semibold">Before and after</h3><p>Before: <span className="whitespace-pre-wrap">{proposal.before.altText || '(empty)'}</span></p><p>After: <span className="whitespace-pre-wrap">{proposal.changes.altText || '(empty)'}</span></p></section>}
      {step === 'confirmed' && proposal && <section className="space-y-3">
        <p role="status" className="flex items-start gap-2 text-blue-200">{verification?.status === 'public_verified' && <Check size={20} className="mt-1 shrink-0" />}{fixStatusLabel(verification?.status ?? String(outcome?.status ?? capability?.workflow?.status ?? 'Waiting for saved result'))}</p>
        {(verification || outcome?.status === 'applied') && <><p>Stored WordPress value: {(verification ? verification.receipt.storedFieldMatches : outcome?.verification === 'verified_stored_fields') ? 'Verified' : 'Not verified'}</p><p>Public page: {verification?.status === 'public_verified' ? 'Verified' : verification?.status === 'public_mismatch' ? 'Does not match' : 'Verification pending'}</p></>}
        {outcome?.status === 'outcome_unknown' && <p className="text-secondary">The result is uncertain. Contact support before trying this fix again.</p>}
        <details className="text-xs text-muted"><summary className="cursor-pointer py-2">Saved execution details</summary><p>Receipt: {verification?.receipt.id ?? proposal.id}</p></details>
      </section>}
      {(busy || error || verifying) && <p role="status" className="whitespace-pre-wrap text-secondary">{busy || error || 'Checking the public page…'}</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-3 border-t border-line p-5 sm:px-6">
      {step === 'review' ? <><button type="button" disabled={!!busy} className={secondary} onClick={onClose}>{supported ? 'Cancel' : 'Done'}</button>{supported && <button type="button" className={primary} disabled={!!busy || !applyReady || generation?.output.status !== 'proposed' || text === target?.currentAlt || !text.trim()} onClick={apply}>Approve &amp; Apply</button>}</> : step === 'confirmed' ? <button type="button" className={primary} onClick={onClose}>Done</button> : null}
    </div>
  </dialog>, document.body)
}
