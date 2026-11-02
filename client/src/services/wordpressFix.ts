import type { FixReviewRequest } from '../types/fixReview'
export interface AltEvidence {
  id: string; expiresAt: string; purpose: 'informative' | 'functional' | 'decorative' | 'unknown'; verifiedDescription: string; descriptionProvenance: string
  target: { mediaId: number; pageResource: 'pages' | 'posts'; pageId: number; sourceUrl: string; pageUrl: string; currentAlt: string; modified: string }
}
export interface FixWorkflow { status: 'draft' | 'pending_approval' | 'expired' | 'applying' | 'applied' | 'public_verified' | 'stored_mismatch' | 'public_mismatch' | 'stored_verified_public_inconclusive' | 'outcome_unknown' | 'failed' | 'restored'; proposal: AltProposal | null; generation: AltGeneration | null; verification: AltVerification | null; pageUrl: string; approvalRequired: boolean; generationApproval?: { status: 'not_required' | 'pending_approval' | 'approved' | 'expired' | 'used'; intentId?: string } }
export interface FixCapability { capability: string; fixable: boolean; reason: string; evidence: AltEvidence | null; writesEnabled: boolean; limitations: string[]; savedGeneration?: AltGeneration | null; workflow?: FixWorkflow | null; liveGenerationAllowed?: boolean }
export interface FixCandidate { businessId: string; reportId: string; findingId: string; evidenceId: string; thumbnailUrl?: string; target: AltEvidence['target']; pageTitle: string | null; pageLanguage: 'es' | 'en' | null; purposeStatus: AltEvidence['purpose'] | 'unreviewed'; capability: FixCapability; issue: string; requiresPurposeConfirmation: boolean; isMock: boolean; collectedAt?: string; imageHash?: string | null; imageHashProvenance?: string | null; review?: FixReviewRequest }
export interface AltGeneration { id: string; isMock: boolean; provider: string; output: { status: 'proposed' | 'insufficient_evidence'; altText: string | null; reason: string } }
export interface AltProposal { id: string; hash: string; expiresAt: string; resource: 'media'; resourceId: number; before: { altText: string }; changes: { altText: string }; field: 'alt_text'; restorationOf: string | null; outcome?: Record<string, unknown> | null; executionStarted?: boolean; textOrigin?: 'human-edited' }
export interface AltVerification { status: string; receipt: { id: string; proposalId: string; storedFieldMatches: boolean; status: string; limitations: string[]; observedAlts: (string | null)[] } }
let csrf = ''
let connecting: Promise<void> | undefined
let connectedSession: { businessId: string; expiresAt: string } | undefined
export class WordPressFixError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code = '') { super(message); this.name = 'WordPressFixError'; this.status = status; this.code = code }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function fixReviewState(capability?: FixCapability | null) {
  const workflow = capability?.workflow, proposal = workflow?.proposal ?? null
  const generation = workflow?.generation ?? capability?.savedGeneration ?? null
  const outcome = proposal?.outcome ?? (proposal?.executionStarted ? { status: 'outcome_unknown' } : null)
  const step = outcome || proposal?.executionStarted ? 'confirmed' : proposal && Date.parse(proposal.expiresAt) > Date.now() ? 'confirm' : 'review'
  return { step: step as 'review' | 'confirm' | 'confirmed', generation, proposal, outcome, verification: workflow?.verification ?? null, text: proposal?.changes.altText ?? generation?.output.altText ?? '' }
}
export function fixActionLabel(capability?: FixCapability | null) {
  if (capability?.workflow?.status === 'public_verified') return 'Verified'
  if (capability?.workflow?.status === 'restored') return 'Restored'
  if (capability?.workflow?.proposal?.executionStarted || capability?.workflow?.proposal?.outcome) return 'Review fix result'
  return capability?.fixable ? 'Fix with AI' : 'Review Recommendation'
}
export function fixStatusLabel(status: string) {
  return status === 'public_verified' ? 'Verified in WordPress and public page' : status.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
}
export function fixGenerationPending(capability: FixCapability | null | undefined, requireLive: boolean) {
  const approval = capability?.workflow?.generationApproval
  return requireLive && capability?.liveGenerationAllowed !== true || !!approval && !['not_required', 'approved'].includes(approval.status)
}
export function notifyWordPressFixChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('wordpress-fix-updated')) }
async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/wordpress/${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json', 'x-wordpress-csrf': csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  let data: unknown
  try { data = await response.json() } catch { throw new WordPressFixError('The WordPress API returned an unavailable response. Check the configured backend and frontend origin.', response.status, 'WORDPRESS_API_UNAVAILABLE') }
  if (!response.ok) {
    const error = object(data) && object(data.error) ? data.error : object(data) ? data : null
    const code = error && typeof error.code === 'string' ? error.code : ''
    if (response.status === 401) { connecting = undefined; connectedSession = undefined; csrf = '' }
    if (/AI_.*(APPROVAL|NOT_FUNDED|NOT_ACTIVATED)|AI_WORDPRESS_ALT_INTENT/.test(code)) throw new Error('Pending administrator approval. No model request was sent. Your proposed text has been preserved.')
    throw new WordPressFixError(error && typeof error.message === 'string' ? error.message : 'The protected WordPress request failed. No automatic retry was made.', response.status, code)
  }
  if (!object(data)) throw new Error('Invalid WordPress response. Inspect saved receipts before further action.')
  return data as T
}
function ticketCode(input: string, businessId?: string) {
  const value = input.trim()
  if (/^[A-Za-z0-9_-]{43}$/.test(value)) return value
  let url: URL
  try { url = new URL(value) } catch { throw new WordPressFixError('Enter a fresh one-use operator link or code, never a server credential.', 400, 'WORDPRESS_TICKET_INVALID') }
  if (typeof window === 'undefined' || url.origin !== window.location.origin || url.pathname !== '/dashboard' || url.username || url.password)
    throw new WordPressFixError('Use the operator link for this exact Dashboard hostname and port.', 400, 'WORDPRESS_TICKET_ORIGIN')
  if (businessId && url.searchParams.get('businessId') && url.searchParams.get('businessId') !== businessId)
    throw new WordPressFixError('This operator link belongs to another business.', 403, 'WORDPRESS_TICKET_BUSINESS')
  const code = new URLSearchParams(url.hash.slice(1)).get('wordpress-session') ?? ''
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new WordPressFixError('The one-use operator link is invalid.', 400, 'WORDPRESS_TICKET_INVALID')
  return code
}
async function establishSession(businessId?: string, code?: string) {
  if (code) await request('browser-session', { code })
  const session = await request<{ csrf: string; businessId: string; expiresAt: string }>('browser-session')
  if (typeof session.csrf !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(session.csrf) || !session.businessId
    || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now())
    throw new WordPressFixError('The operator session is invalid or expired. Reconnect with a fresh one-use link.', 401, 'WORDPRESS_BROWSER_SESSION_REQUIRED')
  if (businessId && session.businessId !== businessId)
    throw new WordPressFixError('This browser connection belongs to another business. Use its authorized operator link.', 401, 'WORDPRESS_BROWSER_SESSION_REQUIRED')
  csrf = session.csrf; connectedSession = { businessId: session.businessId, expiresAt: session.expiresAt }
}
function connectionAttempt(businessId?: string, code?: string) {
  connecting = establishSession(businessId, code).catch(error => { connecting = undefined; connectedSession = undefined; csrf = ''; throw error })
  return connecting
}
/** Redeems only the existing short-lived grant. It cannot mint grants or access server credentials. */
export async function redeemWordPressBrowserTicket(input: string, businessId: string) {
  const code = ticketCode(input, businessId)
  connecting = undefined; connectedSession = undefined; csrf = ''
  await connectionAttempt(businessId, code)
  notifyWordPressFixChanged()
}
export async function disconnectWordPressBrowser() {
  await connectWordPressBrowser()
  await request('browser-session/revoke', {})
  connecting = undefined; connectedSession = undefined; csrf = ''
  notifyWordPressFixChanged()
}
/** The fragment contains a 60-second single-use grant, never an operator/API key. */
export function connectWordPressBrowser(businessId?: string) {
  const fragment = typeof window === 'undefined' ? null : new URLSearchParams(window.location.hash.slice(1)).get('wordpress-session')
  if (fragment) {
    const code = ticketCode(fragment, businessId)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    return connectionAttempt(businessId, code)
  }
  if (connectedSession && (Date.parse(connectedSession.expiresAt) <= Date.now() || businessId && connectedSession.businessId !== businessId)) {
    connecting = undefined; connectedSession = undefined; csrf = ''
  }
  return connecting ?? connectionAttempt(businessId)
}
const base = (businessId: string) => `businesses/${encodeURIComponent(businessId)}/fixes/`
const localReadBase = (businessId: string) => `local/${base(businessId)}`
export async function fixCapability(review: Pick<FixReviewRequest, 'category' | 'businessId' | 'reportId' | 'findingId'>): Promise<FixCapability | null> {
  if (review.category !== 'website' || !review.businessId || !review.reportId || !review.findingId) return null
  const capability = await request<FixCapability>(localReadBase(review.businessId) + `capability?${new URLSearchParams({ reportId: review.reportId, findingId: review.findingId })}`)
  if (capability.capability !== 'wordpress.media.alt_text.update' || typeof capability.fixable !== 'boolean' || capability.fixable && (!capability.evidence?.id || !Number.isSafeInteger(capability.evidence.target.mediaId))) throw new Error('Unsupported fix capability response.')
  return capability
}
export const wordpressFix = {
  candidates: (businessId: string) => request<{ items: FixCandidate[] }>(localReadBase(businessId) + 'candidates'),
  workflows: async (businessId: string) => {
    return request<{ items: { reportId: string; findingId: string; evidenceId: string; workflow: FixWorkflow }[] }>(localReadBase(businessId))
  },
  confirmPurpose: async (businessId: string, candidate: FixCandidate, purpose: AltEvidence['purpose'], verifiedDescription: string, language: 'es' | 'en', requiredTerms: string[]) => {
    await connectWordPressBrowser(businessId)
    return request<AltEvidence>(base(businessId) + 'purpose', { confirmed: true, reportId: candidate.reportId, findingId: candidate.findingId, evidenceId: candidate.evidenceId,
      mediaId: candidate.target.mediaId, pageResource: candidate.target.pageResource, pageId: candidate.target.pageId, purpose, verifiedDescription,
      ...(purpose === 'informative' && language === 'es' ? { proposalLanguage: 'es', requiredTerms } : {}),
      ...(candidate.imageHash && candidate.imageHashProvenance ? { durablePurpose: { originalImageHash: candidate.imageHash, hashProvenance: candidate.imageHashProvenance } } : {}) })
  },
  generate: async (businessId: string, evidenceId: string, instructions: string, intentId?: string, requireLive = false) => {
    await connectWordPressBrowser(businessId)
    return request<AltGeneration>(base(businessId) + 'generations', { evidenceId, instructions, ...(intentId ? { intentId } : {}), ...(requireLive ? { requireLive: true } : {}) })
  },
  propose: async (businessId: string, generationId: string, altText: string) => {
    await connectWordPressBrowser(businessId)
    const proposal = await request<AltProposal>(base(businessId) + 'proposals', { generationId, altText })
    if (!/^[a-f0-9]{64}$/.test(proposal.hash) || proposal.resource !== 'media' || proposal.field !== 'alt_text' || proposal.changes.altText !== altText || Object.keys(proposal.changes).length !== 1) throw new Error('The exact alt-text proposal did not match your review.')
    return proposal
  },
  apply: async (businessId: string, proposal: AltProposal) => { await connectWordPressBrowser(businessId); return request<Record<string, unknown>>(base(businessId) + `proposals/${encodeURIComponent(proposal.id)}/apply`, { confirmed: true, proposalHash: proposal.hash }) },
  read: (businessId: string, id: string) => request<AltProposal>(localReadBase(businessId) + `proposals/${encodeURIComponent(id)}`),
  verify: async (businessId: string, id: string) => { await connectWordPressBrowser(businessId); return request<AltVerification>(base(businessId) + `proposals/${encodeURIComponent(id)}/verifications`, { confirmed: true }) },
  restore: async (businessId: string, id: string) => { await connectWordPressBrowser(businessId); return request<AltProposal>(base(businessId) + `proposals/${encodeURIComponent(id)}/restorations`, { confirmed: true }) },
}
