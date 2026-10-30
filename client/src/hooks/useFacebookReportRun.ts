import { useCallback, useEffect, useRef, useState } from 'react'
import { backendApi, BackendApiError } from '../services/backendApi'

interface State { businessId: string; pageId: string; running: boolean; error: string | null }

export function useFacebookReportRun(businessId: string, pageId: string, refresh: () => void) {
  const [state, setState] = useState<State>({ businessId, pageId, running: false, error: null })
  const actions = useRef<{ businessId: string; pageId: string; start: () => Promise<void> } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let working = false
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setState({ businessId, pageId, running: false, error: null })
    })
    async function start() {
      if (working || !pageId || controller.signal.aborted) return
      working = true
      setState({ businessId, pageId, running: true, error: null })
      let error: string | null = null
      try {
        const result = await backendApi.createFacebookReport(businessId, pageId, controller.signal)
        if (!result.auditId || result.reportId !== result.auditId || !['completed', 'partial', 'failed'].includes(result.status)) {
          throw new BackendApiError('The backend returned an unexpected report response.', 'INVALID_RESPONSE', 0)
        }
        if (result.status === 'failed') error = result.failure?.message ?? 'The Facebook report could not be completed. Please try again.'
      } catch (failure) {
        error = failure instanceof Error ? failure.message : 'The Facebook report could not be started. Please try again.'
      } finally {
        working = false
        if (!controller.signal.aborted) {
          setState({ businessId, pageId, running: false, error })
          // Recover saved results even if the response was lost after collection.
          refresh()
        }
      }
    }
    actions.current = { businessId, pageId, start }
    return () => { controller.abort(); actions.current = null }
  }, [businessId, pageId, refresh])
  const start = useCallback(async () => {
    if (actions.current?.businessId === businessId && actions.current.pageId === pageId) await actions.current.start()
  }, [businessId, pageId])
  const visible = state.businessId === businessId && state.pageId === pageId ? state : { running: false, error: null }
  return { ...visible, start }
}
