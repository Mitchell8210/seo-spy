import type { FixReviewRequest } from '../types/fixReview'

export interface FacebookPost {
  id: string; businessId: string; reportId: string; recommendationId: string; pageId: string; pageName: string
  status: 'generating' | 'draft' | 'generation_failed' | 'publishing' | 'published' | 'outcome_unknown' | 'discarded'
  text: string; model: string | null; attemptId: string | null; approvalHash: string | null; expiresAt: string | null
  postId: string | null; permalink: string | null; verified: boolean; error: string | null
  executedAt?: string | null; completedAt?: string | null
  previousPostId?: string | null
}
const base = `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/facebook/posts`
async function requestValue(path: string, body?: object) {
  const response = await fetch(`${base}${path}`, { credentials: 'same-origin', cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  let value
  try { value = await response.json() }
  catch { throw new Error('The Facebook API returned an unavailable response. Check that the backend is running, then reopen this review. No automatic publishing retry was started.') }
  if (!response.ok) throw new Error(typeof value?.error?.message === 'string' ? value.error.message : typeof value?.message === 'string' ? value.message : 'The Facebook post request could not be completed. Your saved result can be checked before trying again.')
  return value
}
async function request(path: string, body?: object): Promise<FacebookPost | null> {
  const value = await requestValue(path, body)
  if (value === null) return null
  if (!value || typeof value.id !== 'string' || typeof value.pageId !== 'string' || typeof value.text !== 'string' || typeof value.businessId !== 'string' ||
    !['generating', 'draft', 'generation_failed', 'publishing', 'published', 'outcome_unknown', 'discarded'].includes(value.status)) throw new Error('The saved Facebook post response was invalid.')
  return value as FacebookPost
}
export const isFacebookPostingReview = (review: FixReviewRequest) => review.category === 'social' && !!review.businessId && !!review.reportId &&
  (review.findingId === 'score:social:posting' || /post|publishing/i.test(`${review.title} ${review.recommendation ?? ''}`))
export const facebookPosts = {
  history: async (businessId: string): Promise<{ businessId: string; items: FacebookPost[] }> => {
    const value = await requestValue(`/history?${new URLSearchParams({ businessId })}`)
    if (value?.businessId !== businessId || !Array.isArray(value.items) || value.items.some((item: FacebookPost) => !item || item.businessId !== businessId || typeof item.id !== 'string' || typeof item.pageName !== 'string' || typeof item.text !== 'string' || !['published', 'publishing', 'outcome_unknown'].includes(item.status))) throw new Error('The saved Facebook action history was invalid.')
    return value
  },
  saved: (review: FixReviewRequest, id?: string) => request(`?${new URLSearchParams({ businessId: review.businessId!, ...(id ? { id } : { reportId: review.reportId!, recommendationId: review.id }) })}`),
  generate: (review: FixReviewRequest, previousPostId?: string) => request('/draft', { businessId: review.businessId, reportId: review.reportId, recommendationId: review.id, ...(review.findingId ? { findingId: review.findingId } : {}), ...(previousPostId ? { previousPostId } : {}) }),
  propose: (businessId: string, id: string, text: string) => request('/proposal', { businessId, id, text }),
  discard: (businessId: string, id: string) => request('/discard', { businessId, id }),
  publish: (businessId: string, id: string, approvalHash: string) => request('/publish', { businessId, id, approvalHash, confirmed: true }),
}
