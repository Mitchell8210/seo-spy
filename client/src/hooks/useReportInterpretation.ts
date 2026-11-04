import { useEffect, useState } from 'react'
import type { InvestigationInterpretation } from '../types/investigationInterpretation'

export function useReportInterpretation(businessId: string, reportIds: string[], revision?: string) {
  const ids = [...new Set(reportIds)].sort().join(',')
  const key = `${businessId}:${ids}:${revision ?? ''}`
  const [state, setState] = useState<{ key: string; interpretation: InvestigationInterpretation | null }>({ key: '', interpretation: null })
  useEffect(() => {
    if (!ids) return
    const controller = new AbortController()
    void fetch(`/api/wordpress/local/businesses/${encodeURIComponent(businessId)}/investigation-interpretation?reportIds=${encodeURIComponent(ids)}`, { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error()
        const value = await response.json() as { businessId: string; interpretation: InvestigationInterpretation | null }
        if (value.businessId !== businessId || value.interpretation && (value.interpretation.businessId !== businessId || value.interpretation.schemaVersion !== 'investigation-interpretation-v1')) throw new Error()
        if (!controller.signal.aborted) setState({ key, interpretation: value.interpretation })
      }).catch(() => { if (!controller.signal.aborted) setState({ key, interpretation: null }) })
    return () => controller.abort()
  }, [businessId, ids, key])
  return state.key === key ? state.interpretation : null
}
