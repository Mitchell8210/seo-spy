import type { FixReviewRequest } from '../types/fixReview'
export interface AltEvidence {
  id: string; expiresAt: string; purpose: 'informative' | 'decorative' | 'unknown'; verifiedDescription: string; descriptionProvenance: string
  target: { mediaId: number; pageResource: 'pages' | 'posts'; pageId: number; sourceUrl: string; pageUrl: string; currentAlt: string; modified: string }
}
export interface FixCapability { capability: string; fixable: boolean; reason: string; evidence: AltEvidence | null; writesEnabled: boolean; limitations: string[]; savedGeneration?: AltGeneration | null }
export interface AltGeneration { id: string; isMock: boolean; provider: string; output: { status: 'proposed' | 'insufficient_evidence'; altText: string | null; reason: string } }
export interface AltProposal { id: string; hash: string; expiresAt: string; resource: 'media'; resourceId: number; before: { altText: string }; changes: { altText: string }; field: 'alt_text'; restorationOf: string | null; outcome?: Record<string, unknown>; executionStarted?: boolean }
export interface AltVerification { status: string; receipt: { id: string; proposalId: string; storedFieldMatches: boolean; status: string; limitations: string[]; observedAlts: (string | null)[] } }
let csrf = ''
let connecting: Promise<void> | undefined
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/wordpress/${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json', 'x-wordpress-csrf': csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error(object(data) && object(data.error) && typeof data.error.message === 'string' ? data.error.message : 'The protected WordPress request failed. No automatic retry was made.')
  if (!object(data)) throw new Error('Invalid WordPress response. Inspect saved receipts before further action.')
  return data as T
}
/** The fragment contains a 60-second single-use grant, never an operator/API key. */
export function connectWordPressBrowser() {
  if (!connecting) connecting = (async () => {
    const fragment = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.hash.slice(1)).get('wordpress-session')
    if (fragment) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      await request('browser-session', { code: fragment })
    }
    const session = await request<{ csrf: string }>('browser-session')
    if (typeof session.csrf !== 'string' || session.csrf.length !== 43) throw new Error('Invalid operator session.')
    csrf = session.csrf
  })()
  return connecting
}
const base = (businessId: string) => `businesses/${encodeURIComponent(businessId)}/fixes/`
export async function fixCapability(review: Pick<FixReviewRequest, 'category' | 'businessId' | 'reportId' | 'findingId'>): Promise<FixCapability | null> {
  await connectWordPressBrowser()
  if (review.category !== 'website' || !review.businessId || !review.reportId || !review.findingId) return null
  const capability = await request<FixCapability>(base(review.businessId) + `capability?${new URLSearchParams({ reportId: review.reportId, findingId: review.findingId })}`)
  if (capability.capability !== 'wordpress.media.alt_text.update' || typeof capability.fixable !== 'boolean' || capability.fixable && (!capability.evidence?.id || !Number.isSafeInteger(capability.evidence.target.mediaId))) throw new Error('Unsupported fix capability response.')
  return capability
}
export const wordpressFix = {
  generate: (businessId: string, evidenceId: string, instructions: string) => request<AltGeneration>(base(businessId) + 'generations', { evidenceId, instructions }),
  propose: async (businessId: string, generationId: string, altText: string) => {
    const proposal = await request<AltProposal>(base(businessId) + 'proposals', { generationId, altText })
    if (!/^[a-f0-9]{64}$/.test(proposal.hash) || proposal.resource !== 'media' || proposal.field !== 'alt_text' || proposal.changes.altText !== altText || Object.keys(proposal.changes).length !== 1) throw new Error('The exact alt-text proposal did not match your review.')
    return proposal
  },
  apply: (businessId: string, proposal: AltProposal) => request<Record<string, unknown>>(base(businessId) + `proposals/${encodeURIComponent(proposal.id)}/apply`, { confirmed: true, proposalHash: proposal.hash }),
  read: (businessId: string, id: string) => request<AltProposal>(base(businessId) + `proposals/${encodeURIComponent(id)}`),
  verify: (businessId: string, id: string) => request<AltVerification>(base(businessId) + `proposals/${encodeURIComponent(id)}/verifications`, { confirmed: true }),
  restore: (businessId: string, id: string) => request<AltProposal>(base(businessId) + `proposals/${encodeURIComponent(id)}/restorations`, { confirmed: true }),
}
