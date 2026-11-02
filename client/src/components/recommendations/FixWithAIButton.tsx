import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { FixReviewRequest } from '../../types/fixReview'
import { FixReviewDialog } from './FixReviewDialog'
import { fixCapability, type FixCapability } from '../../services/wordpressFix'

export function FixWithAIButton({ review, className, children, onOpen, ariaLabel }: {
  review: FixReviewRequest
  className: string
  children?: ReactNode
  onOpen?: () => void
  ariaLabel?: string
}) {
  const [selected, setSelected] = useState<FixReviewRequest | null>(null)
  const { category, businessId, reportId, findingId } = review
  const key = JSON.stringify([category, businessId, reportId, findingId])
  const [resolved, setResolved] = useState<{ key: string; value: FixCapability | null } | null>(null)
  const capability = resolved?.key === key ? resolved.value : null
  useEffect(() => {
    let active = true
    void fixCapability({ category, businessId, reportId, findingId }).then(value => { if (active) setResolved({ key, value }) }).catch(() => { if (active) setResolved({ key, value: null }) })
    return () => { active = false }
  }, [category, businessId, reportId, findingId, key])
  const label = capability?.fixable ? 'Fix with AI' : 'Review Recommendation'
  return <>
    <button type="button" className={className} aria-label={ariaLabel?.replace('Fix with AI', label)} aria-haspopup="dialog" onClick={async () => {
      let value: FixCapability | null = null
      try { value = await fixCapability({ category, businessId, reportId, findingId }) } catch { /* Informational review stays available. */ }
      setResolved({ key, value })
      setSelected(structuredClone(review))
      onOpen?.()
    }}>{children}{label}</button>
    {selected && <FixReviewDialog review={selected} capability={capability} onClose={() => setSelected(null)} />}
  </>
}
