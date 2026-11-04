import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { FixReviewRequest } from '../../types/fixReview'
import { FixReviewDialog } from './FixReviewDialog'
import { FacebookPostReviewDialog } from './FacebookPostReviewDialog'
import { isFacebookPostingReview } from '../../services/facebookPosts'
import { fixCapability, fixActionLabel, type FixCapability } from '../../services/wordpressFix'

export function FixWithAIButton({ review, className, children, onOpen, ariaLabel, iconOnly = false, actionLabel }: {
  review: FixReviewRequest
  className: string
  children?: ReactNode
  onOpen?: (hasExecution: boolean) => void
  ariaLabel?: string
  iconOnly?: boolean
  actionLabel?: string
}) {
  const [selected, setSelected] = useState<FixReviewRequest | null>(null)
  const { category, businessId, reportId, findingId } = review
  const key = JSON.stringify([category, businessId, reportId, findingId])
  const [resolved, setResolved] = useState<{ key: string; value: FixCapability | null } | null>(null)
  const capability = resolved?.key === key ? resolved.value : null
  useEffect(() => {
    let active = true
    const refresh = () => { void fixCapability({ category, businessId, reportId, findingId }).then(value => { if (active) setResolved({ key, value }) }).catch(() => { if (active) setResolved({ key, value: null }) }) }
    refresh()
    window.addEventListener('wordpress-fix-updated', refresh)
    return () => { active = false; window.removeEventListener('wordpress-fix-updated', refresh) }
  }, [category, businessId, reportId, findingId, key])
  const label = actionLabel ?? fixActionLabel(capability)
  return <>
    <button type="button" className={className} aria-label={ariaLabel?.replace('Fix with AI', label)} aria-haspopup="dialog" onClick={async () => {
      let value: FixCapability | null = null
      try { value = await fixCapability({ category, businessId, reportId, findingId }) } catch { /* Informational review stays available. */ }
      setResolved({ key, value })
      setSelected(structuredClone(review))
      onOpen?.(!!(value?.workflow?.proposal?.executionStarted || value?.workflow?.proposal?.outcome))
    }}>{children}{iconOnly ? <span className="sr-only">{label}</span> : label}</button>
    {selected && (isFacebookPostingReview(selected) ? <FacebookPostReviewDialog review={selected} onClose={() => setSelected(null)} /> : <FixReviewDialog review={selected} capability={capability} onClose={() => setSelected(null)} />)}
  </>
}
