import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { FixReviewRequest } from '../../types/fixReview'
import { facebookPosts, type FacebookPost } from '../../services/facebookPosts'

const primary = 'min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
const secondary = 'min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-medium text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300'

export function FacebookPostReviewDialog({ review, onClose }: { review: FixReviewRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId(), busyRef = useRef(false)
  const [post, setPost] = useState<FacebookPost | null>(null), [text, setText] = useState('')
  const [busy, setBusy] = useState('Loading saved post…'), [error, setError] = useState(''), [loaded, setLoaded] = useState(false)
  const accept = (value: FacebookPost | null) => {
    setPost(value); setText(value && value.status !== 'discarded' ? value.text : '')
    if (value && ['published', 'publishing', 'outcome_unknown'].includes(value.status)) window.dispatchEvent(new Event('facebook-post-updated'))
  }
  useEffect(() => {
    let active = true
    void facebookPosts.saved(review).then(value => { if (active) { accept(value); setLoaded(true) } }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load the saved post.')
    }).finally(() => { if (active) setBusy('') })
    return () => { active = false }
  }, [review])
  useEffect(() => {
    const element = dialog.current!, previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    element.showModal(); document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus() }
  }, [])
  const run = async (label: string, work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(label); setError('')
    try { await work() } catch (failure) { setError(failure instanceof Error ? failure.message : 'The post action could not be completed.') }
    finally { busyRef.current = false; setBusy('') }
  }
  const publish = () => {
    if (!post) return
    const approvedText = text, target = post
    void run('Publishing your approved post…', async () => {
      const proposal = await facebookPosts.propose(review.businessId!, target.id, approvedText)
      if (!proposal?.approvalHash || proposal.text !== approvedText || proposal.pageId !== target.pageId || proposal.id !== target.id)
        throw new Error('The reviewed post changed. Reload the saved draft before approving again.')
      setPost(proposal)
      try { accept(await facebookPosts.publish(review.businessId!, proposal.id, proposal.approvalHash)) }
      catch (failure) {
        // Read once after an interrupted response. Never automatically resend the publishing request.
        try { accept(await facebookPosts.saved(review, proposal.id)) } catch { setPost({ ...proposal, status: 'outcome_unknown' }) }
        throw failure
      }
    })
  }
  const close = () => {
    if (busyRef.current || busy) return
    if (post && ['draft', 'generation_failed'].includes(post.status)) {
      void run('Discarding your unpublished draft…', async () => {
        const discarded = await facebookPosts.discard(review.businessId!, post.id)
        if (discarded?.status !== 'discarded') throw new Error('The draft could not be discarded. Check the saved result before closing this review.')
        onClose()
      })
    } else onClose()
  }
  const completed = post && ['published', 'publishing', 'outcome_unknown'].includes(post.status)
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close() }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/70">
    <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
      <div><p className="text-xs font-semibold text-blue-300">Fix with AI · Social Media</p><h2 id={titleId} className="mt-2 text-xl font-semibold">{completed ? 'Facebook post result' : 'Review Facebook post'}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">Review or edit the post, then approve the exact text for publication.</p></div>
      <button type="button" aria-label="Close fix review" disabled={!!busy} onClick={close} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line text-secondary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-300"><X size={20} /></button>
    </div>
    <div className="space-y-5 p-5 text-sm leading-6 [overflow-wrap:anywhere] sm:p-6">
      <section><h3 className="font-semibold text-ink">{review.title}</h3><p className="mt-2 text-secondary">{review.explanation}</p>
        {review.recommendation && review.recommendation !== review.explanation && <p className="mt-2 text-secondary">{review.recommendation}</p>}
      </section>
      {post && post.status !== 'discarded' && <section className="space-y-2 rounded-lg border border-line p-4"><h3 className="font-semibold">{post.pageName}</h3><p className="text-xs text-muted">Facebook Page {post.pageId}</p>
        {post.attemptId && <p className="text-xs text-muted">Live Meta Muse draft · {post.model}</p>}
      </section>}
      {post?.status === 'draft' && <label className="block font-semibold">Proposed Facebook post<textarea aria-label="Proposed Facebook post" disabled={!!busy} value={text} maxLength={5000} rows={8} onChange={event => setText(event.target.value)} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 text-sm text-ink focus:outline-2 focus:outline-blue-300" /></label>}
      {post?.status === 'draft' && <p className="text-xs text-muted">Approve &amp; Publish makes this text public on the Page shown above. Check every business claim before approving.</p>}
      {completed && <section className="space-y-3">
        <p role="status">{post.status === 'published' ? post.verified ? 'Published. Facebook readback confirmed the exact approved text.' : 'Facebook confirmed publication. Independent text verification is pending.' : 'Publishing may have started. Check the Page before posting again; this action will not be retried.'}</p>
        <p className="whitespace-pre-wrap rounded-lg border border-line p-4">{post.text}</p>
        {post.permalink && /^https:\/\/(www\.)?facebook\.com\//.test(post.permalink) && <a href={post.permalink} target="_blank" rel="noreferrer" className="text-blue-300">View published post</a>}
        <p className="text-xs text-muted">One post starts the task. Continue posting regularly and use a future report to review activity.</p>
      </section>}
      {post?.status === 'generating' && <p role="status">Draft generation is in progress or was interrupted. Reopen this review to check the saved result; no automatic retry will run.</p>}
      {post?.error && <p role="status" className="text-secondary">{post.error}</p>}
      {busy && <p role="status" className="text-secondary">{busy}</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-3 border-t border-line p-5 sm:p-6">
      <button type="button" className={secondary} disabled={!!busy} onClick={close}>Close</button>
      {(!post || post.status === 'discarded') && loaded && <button type="button" className={primary} disabled={!!busy} onClick={() => { void run('Generating your Meta Muse draft…', async () => accept(await facebookPosts.generate(review, post?.id))) }}>Generate AI post</button>}
      {post && ['published', 'generation_failed'].includes(post.status) && <button type="button" className={primary} disabled={!!busy} onClick={() => {
        const previousPostId = post.id
        void run('Generating your next Meta Muse draft…', async () => accept(await facebookPosts.generate(review, previousPostId)))
      }}>Generate another post</button>}
      {post?.status === 'draft' && <button type="button" className={primary} disabled={!!busy || !text.trim()} onClick={publish}>Approve &amp; Publish</button>}
    </div>
  </dialog>, document.body)
}
