import { useEffect, useState } from 'react'
import { backendApi } from '../services/backendApi'
import type { SavedAssessment } from '../types/assessment'

/** Saved reads only; failure clears eligibility without hiding the channel report. */
export function useSavedAssessment(businessId: string, reportId?: string) {
  const [state, setState] = useState<{ businessId: string; reportId: string; assessment: SavedAssessment | null } | null>(null)
  useEffect(() => {
    if (!reportId) return
    const abort = new AbortController()
    let busy = false
    const refresh = async () => {
      if (busy || abort.signal.aborted) return
      busy = true
      try {
        const data = await backendApi.latestAssessment(businessId, abort.signal)
        if (!abort.signal.aborted) setState({ businessId, reportId, assessment: data.businessId === businessId ? data.assessment : null })
      } catch {
        if (!abort.signal.aborted) setState({ businessId, reportId, assessment: null })
      } finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 15000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { abort.abort(); clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [businessId, reportId])
  return state?.businessId === businessId && state.reportId === reportId ? state.assessment : null
}
