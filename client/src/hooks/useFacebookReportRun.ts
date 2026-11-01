import { useCallback, useEffect, useRef, useState } from 'react'
import { backendApi, BackendApiError } from '../services/backendApi'

interface State { businessId: string; pageId: string; running: boolean; error: string | null }

export function useFacebookReportRun(businessId: string, pageId: string, refresh: () => void) {
  const [state, setState] = useState<State>({ businessId, pageId, running: false, error: null })
  const actions = useRef<{ businessId: string; pageId: string; start: () => Promise<void> } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let working = false
    let polling = false
    let knownRunning = false
    let latest = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    function update(patch: Partial<State>) {
      if (!controller.signal.aborted) setState(previous => ({
        ...(previous.businessId === businessId && previous.pageId === pageId ? previous : { businessId, pageId, running: false, error: null }), ...patch,
      }))
    }
    async function poll() {
      if (polling || controller.signal.aborted) return
      polling = true
      if (timer) clearTimeout(timer)
      try {
        const status = await backendApi.facebookReportStatus(businessId, controller.signal)
        if (status.businessId !== businessId) throw new BackendApiError('The report status did not match this business.', 'REPORT_MISMATCH', 0)
        const wasRunning = knownRunning
        knownRunning = Boolean(status.active)
        update({ running: working || knownRunning })
        const outcome = status.latest
        const revision = JSON.stringify(outcome)
        if (!knownRunning && (wasRunning || (outcome && revision !== latest))) {
          refresh()
          if (outcome?.error) update({ error: outcome.error.message })
          else if (outcome?.result?.status === 'failed') update({ error: outcome.result.failure?.message ?? 'The Facebook report could not be completed. Please try again.' })
          else if (wasRunning) update({ error: null })
        }
        latest = revision
      } catch (failure) {
        // Saved reports remain readable without a current browser connection.
        if (knownRunning) update({ error: failure instanceof Error ? failure.message : 'The Facebook report status could not be loaded.' })
      } finally {
        polling = false
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), knownRunning || working ? 2500 : 15000)
      }
    }
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setState({ businessId, pageId, running: false, error: null })
    })
    async function start() {
      if (working || knownRunning || controller.signal.aborted) return
      if (!pageId) { update({ error: 'No saved Facebook Page is selected. Connect Facebook and generate its first report before running an investigation.' }); return }
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
          setState({ businessId, pageId, running: knownRunning, error })
          // Recover saved results even if the response was lost after collection.
          refresh()
          void poll()
        }
      }
    }
    actions.current = { businessId, pageId, start }
    const onFocus = () => void poll()
    window.addEventListener('focus', onFocus)
    void poll()
    return () => { controller.abort(); if (timer) clearTimeout(timer); window.removeEventListener('focus', onFocus); actions.current = null }
  }, [businessId, pageId, refresh])
  const start = useCallback(async () => {
    if (actions.current?.businessId === businessId && actions.current.pageId === pageId) await actions.current.start()
  }, [businessId, pageId])
  const visible = state.businessId === businessId && state.pageId === pageId ? state : { running: false, error: null }
  return { ...visible, start }
}
