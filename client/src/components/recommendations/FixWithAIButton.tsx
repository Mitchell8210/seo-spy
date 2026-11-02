import { useState } from 'react'
import type { ReactNode } from 'react'
import type { FixReviewRequest } from '../../types/fixReview'
import { FixReviewDialog } from './FixReviewDialog'

export function FixWithAIButton({ review, className, children, onOpen, ariaLabel }: {
  review: FixReviewRequest
  className: string
  children?: ReactNode
  onOpen?: () => void
  ariaLabel?: string
}) {
  const [selected, setSelected] = useState<FixReviewRequest | null>(null)
  return <>
    <button type="button" className={className} aria-label={ariaLabel} aria-haspopup="dialog" onClick={() => {
      setSelected(structuredClone(review))
      onOpen?.()
    }}>{children ?? 'Fix with AI'}</button>
    {selected && <FixReviewDialog review={selected} onClose={() => setSelected(null)} />}
  </>
}
