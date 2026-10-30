import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react'
import type { AuditSummary, LabError } from '../../types/backend'

const stageLabels: Record<AuditSummary['stage'], string> = {
  queued: 'Investigation queued.',
  collecting_evidence: 'Collecting website evidence…',
  evaluating_checks: 'Evaluating website checks…',
  running_lighthouse: 'Measuring website quality…',
  preparing_recommendations: 'Preparing recommendations…',
  complete: 'Investigation finished.',
  failed: 'Investigation failed.',
}

function completionTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

export function InvestigationStatus({ audit, loading, submitting, error, onRetry }: {
  audit: AuditSummary | null
  loading: boolean
  submitting: boolean
  error: LabError | null
  onRetry: () => Promise<void>
}) {
  const running = audit?.status === 'queued' || audit?.status === 'running'
  const pending = loading || submitting || running
  const message = submitting ? 'Starting investigation…'
    : loading ? 'Checking investigation status…'
      : audit?.status === 'completed' ? 'Investigation complete. Report generated. Dashboard results below are still illustrative.'
        : audit?.status === 'partial' ? 'Investigation partially completed. A partial report is available. Dashboard results below are still illustrative.'
          : audit?.status === 'failed' ? 'Investigation failed. A complete report could not be generated.'
            : audit ? stageLabels[audit.stage] : null
  const finishedAt = audit ? completionTime(audit.completedAt) : null
  const Icon = pending ? LoaderCircle : audit?.status === 'completed' ? CheckCircle2 : CircleAlert

  return (
    <div data-testid="dashboard-investigation-status" className="mt-4 space-y-3">
      <div role="status" aria-live="polite" aria-atomic="true">
        {message && <div className="rounded-lg bg-blue-950 p-3 text-sm leading-6 text-blue-200">
          <p className="flex items-start gap-2"><Icon size={18} className={`mt-0.5 shrink-0 ${pending ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" /><span>{message}</span></p>
          {running && !error && <p className="mt-2 text-xs leading-5 text-blue-200">The investigation continues in the background. Status updates automatically.</p>}
          {audit?.failure && <p className="mt-2 break-words text-xs leading-5 text-amber-200">{audit.failure.message}</p>}
          {audit && <p className="mt-2 break-all text-xs leading-5 text-blue-200">Audit {audit.id}{finishedAt ? ` · Finished ${finishedAt}` : ''}</p>}
        </div>}
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm leading-6 text-red-200">
        <p className="font-semibold">Could not update investigation status</p>
        <p className="mt-1 break-words">{error.message}</p>
        <p className="mt-2 text-xs leading-5">Retry checks for existing work before allowing another investigation to start.</p>
        <button data-testid="dashboard-investigation-retry" type="button" onClick={() => void onRetry()} disabled={loading || submitting} className="mt-3 min-h-11 rounded-lg border border-red-700 px-4 py-2 font-semibold hover:bg-red-950 disabled:opacity-60">Retry status check</button>
      </div>}
    </div>
  )
}
