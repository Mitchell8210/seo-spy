import { useEffect, useState } from 'react'
import { emptyAnalytics, loadAnalysis, type AnalysisView } from '../services/analysisApi'

const initial = (businessId: string) => ({ businessId, data: emptyAnalytics(), caption: 'Loading Google Analytics…' })
export function useAnalysis(businessId: string): AnalysisView {
  const [state, setState] = useState(() => initial(businessId))
  useEffect(() => {
    const controller = new AbortController()
    void loadAnalysis(businessId, controller.signal).then(view => {
      if (!controller.signal.aborted) setState({ businessId, ...view })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ businessId, data: emptyAnalytics(), caption: 'Google Analytics could not be loaded for this website. Traffic is unavailable.' })
    })
    return () => controller.abort()
  }, [businessId])
  return state.businessId === businessId ? state : initial(businessId)
}
