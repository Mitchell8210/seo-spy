import { useCallback, useEffect, useRef, useState } from 'react'
import { backendApi, BackendApiError } from '../services/backendApi'
import type { AuditSummary, LabError } from '../types/backend'

export const INVESTIGATION_POLL_MS = 2500

function active(audit: AuditSummary | null) {
  return audit?.status === 'queued' || audit?.status === 'running'
}

interface State {
  businessId: string
  audit: AuditSummary | null
  loading: boolean
  submitting: boolean
  error: LabError | null
}

const initial = (businessId: string): State => ({ businessId, audit: null, loading: true, submitting: false, error: null })
const errorDetail = (error: unknown): LabError => error instanceof BackendApiError
  ? { message: error.message, code: error.code, requestId: error.requestId }
  : { message: 'The investigation status could not be loaded. Please retry.' }

export function useInvestigation(businessId: string) {
  const [state, setState] = useState<State>(() => initial(businessId))
  const actions = useRef<{ businessId: string; start: () => Promise<void>; retry: () => Promise<void> } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let disposed = false
    let working = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let current = initial(businessId)

    function update(patch: Partial<State>) {
      if (disposed) return
      current = { ...current, ...patch }
      setState(current)
    }

    function validate(audit: AuditSummary, expectedId?: string) {
      if (!audit || typeof audit.id !== 'string' || !audit.id.trim() || audit.businessId !== businessId ||
          (expectedId !== undefined && audit.id !== expectedId)) {
        throw new BackendApiError('The investigation response did not match this business.', 'AUDIT_MISMATCH', 0)
      }
      return audit
    }

    function clearTimer() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    function schedule() {
      clearTimer()
      if (!disposed && active(current.audit) && !current.error) {
        timer = setTimeout(() => { void poll() }, INVESTIGATION_POLL_MS)
      }
    }

    async function dashboard() {
      if (!businessId.trim()) throw new BackendApiError('Choose a business before running an investigation.', 'INVALID_BUSINESS', 0)
      const data = await backendApi.dashboard(businessId, signal)
      if (data.business?.id !== businessId) throw new BackendApiError('The backend returned a different business.', 'BUSINESS_MISMATCH', 0)
      const latest = data.latestAudit ? validate(data.latestAudit) : null
      const running = data.activeAudit ? validate(data.activeAudit) : null
      const completed = latest?.mode === 'live' && (latest.status === 'completed' || latest.status === 'partial') ? latest : null
      // The dashboard can retain an older successful report after the known attempt finishes or fails.
      const known = current.audit
      const keepKnown = known && !active(known) && (!completed || completed.id === known.id ||
        Date.parse(known.createdAt) >= Date.parse(completed.createdAt))
      const audit = active(running) ? running : keepKnown ? known : completed
      update({ audit, error: null, loading: false })
    }

    async function poll() {
      if (disposed || working || !active(current.audit) || !current.audit) return
      working = true
      try {
        const id = current.audit.id
        const audit = validate(await backendApi.audit(id, signal), id)
        update({ audit, error: null })
      } catch (error) {
        if (!disposed) update({ error: errorDetail(error) })
      } finally {
        working = false
        schedule()
      }
    }

    async function retry() {
      if (disposed || working || current.submitting) return
      working = true
      clearTimer()
      update({ loading: true, error: null })
      try {
        // Recover the known attempt first: the dashboard may still show an older successful report.
        if (current.audit) {
          const id = current.audit.id
          try {
            update({ audit: validate(await backendApi.audit(id, signal), id) })
          } catch (error) {
            if (disposed) return
            if (error instanceof BackendApiError && error.status === 404 && error.code === 'AUDIT_NOT_FOUND') {
              update({ audit: null })
            } else {
              throw error
            }
          }
        }
        await dashboard()
      } catch (error) {
        if (!disposed) update({ loading: false, error: errorDetail(error) })
      } finally {
        working = false
        schedule()
      }
    }

    async function start() {
      if (disposed || working || current.loading || current.submitting || active(current.audit) || current.error) return
      const previousId = current.audit?.id
      working = true
      clearTimer()
      update({ submitting: true, error: null })
      try {
        const audit = validate(await backendApi.create(businessId, 'lighthouse', 'mobile', signal))
        update({ audit })
      } catch (error) {
        if (!disposed) {
          const original = errorDetail(error)
          try {
            // The server may have accepted a POST whose response never reached the browser.
            await dashboard()
            const discovered = current.audit
            const recovered = active(discovered) || (discovered?.id !== previousId && discovered?.mode === 'live' &&
              (discovered.status === 'completed' || discovered.status === 'partial'))
            if (!recovered) update({ error: original })
          } catch {
            update({ error: original })
          }
        }
      } finally {
        if (!disposed) update({ submitting: false })
        working = false
        schedule()
      }
    }

    actions.current = { businessId, start, retry }
    working = true
    void dashboard().catch((error: unknown) => {
      if (!disposed) update({ loading: false, error: errorDetail(error) })
    }).finally(() => { working = false; schedule() })

    return () => {
      disposed = true
      clearTimer()
      controller.abort()
      actions.current = null
    }
  }, [businessId])

  const start = useCallback(async () => {
    if (actions.current?.businessId === businessId) await actions.current.start()
  }, [businessId])
  const retry = useCallback(async () => {
    if (actions.current?.businessId === businessId) await actions.current.retry()
  }, [businessId])
  const visible = state.businessId === businessId ? state : initial(businessId)
  return { audit: visible.audit, loading: visible.loading, submitting: visible.submitting,
    busy: visible.loading || visible.submitting || active(visible.audit), error: visible.error, start, retry }
}
