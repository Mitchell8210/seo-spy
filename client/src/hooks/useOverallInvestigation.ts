import { useCallback, useEffect, useRef, useState } from 'react'
import { backendApi } from '../services/backendApi'
import { createOverallInvestigationSession, initialOverallInvestigation, investigationActive } from '../services/overallInvestigation'

export function useOverallInvestigation(businessId: string) {
  const [state, setState] = useState(() => initialOverallInvestigation(businessId))
  const actions = useRef<{ businessId: string; start: () => Promise<void>; refresh: () => Promise<void> } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const session = createOverallInvestigationSession(businessId, backendApi, controller.signal, setState)
    actions.current = { businessId, start: session.start, refresh: session.refresh }
    void session.refresh()
    return () => { session.dispose(); controller.abort(); actions.current = null }
  }, [businessId])
  const start = useCallback(async () => {
    if (actions.current?.businessId === businessId) await actions.current.start()
  }, [businessId])
  const retry = useCallback(async () => {
    if (actions.current?.businessId === businessId) await actions.current.refresh()
  }, [businessId])
  const visible = state.businessId === businessId ? state : initialOverallInvestigation(businessId)
  return { ...visible, busy: visible.loading || visible.submitting || investigationActive(visible.audit), start, retry }
}
