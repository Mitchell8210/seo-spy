import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowUpRight, FlaskConical, LoaderCircle, Play, RefreshCw } from 'lucide-react'
import { StatusBadge } from '../../components/common/StatusBadge'
import { AuditFindings, LighthouseResults } from './BackendLabResults'
import { formatTime } from './format'
import { useBackendLab } from './useBackendLab'
import type { AuditScope, LighthouseStrategy } from './types'

const stageLabels: Record<string, string> = {
  queued: 'Investigation queued', collecting_evidence: 'Collecting homepage evidence',
  evaluating_checks: 'Checking the homepage', running_lighthouse: 'Measuring with Google Lighthouse',
  preparing_recommendations: 'Preparing recommendations', complete: 'Investigation finished', failed: 'Investigation failed',
}

function safeWebsite(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

export default function BackendLab() {
  const { businessId = 'demo-guzman' } = useParams()
  const lab = useBackendLab(businessId)
  const [scope, setScope] = useState<Exclude<AuditScope, 'demo'>>('lighthouse')
  const [strategy, setStrategy] = useState<LighthouseStrategy>('mobile')
  const busy = lab.submitting || Boolean(lab.activeAudit)
  const current = lab.activeAudit ?? lab.lastAttempt ?? lab.displayedAudit
  const simulated = lab.displayedAudit?.mode === 'demo'
  const warnings = [...new Set([...(lab.displayedAudit?.warnings ?? []), ...(lab.lastAttempt?.warnings ?? []), ...(lab.lighthouse?.warnings ?? [])])]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3"><StatusBadge label="Isolated integration test" tone="blue" /></div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl"><FlaskConical className="shrink-0 text-blue-400" aria-hidden="true" />Backend test dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">Test homepage and Lighthouse investigations through the backend API. The existing dashboard and its mock data are unchanged.</p>
        </div>
        <Link to="/dashboard" className="rounded-sm text-sm font-medium text-blue-300 underline-offset-4 hover:underline">Back to the demo dashboard</Link>
      </div>

      {lab.error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-5 text-sm leading-6 text-red-200">
        <p className="font-semibold">Could not update the test dashboard</p>
        <p className="mt-1 break-words">{lab.error.message}</p>
        <p className="mt-2">Make sure the backend is running on port 3001. If the API response is not JSON, restart the frontend development server and retry.</p>
        <button type="button" onClick={() => void lab.retry()} className="mt-3 min-h-11 rounded-lg border border-red-700 px-4 py-2 font-semibold hover:bg-red-950">Retry connection</button>
      </div>}

      {lab.loading && !lab.dashboard && <p role="status" className="flex items-center gap-2 text-sm text-secondary"><LoaderCircle className="motion-safe:animate-spin" size={18} aria-hidden="true" />Loading the business from the backend…</p>}

      {lab.dashboard && <>
        <section aria-labelledby="lab-business-title" className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-7">
          <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-start">
            <div className="min-w-0">
              <div className="mb-3"><StatusBadge label={simulated ? 'Simulated demo results' : lab.displayedAudit ? 'Live audit results' : 'Ready to investigate'} tone={simulated ? 'neutral' : 'blue'} /></div>
              <h2 id="lab-business-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{lab.dashboard.business.name}</h2>
              {safeWebsite(lab.dashboard.business.website) ? <a href={safeWebsite(lab.dashboard.business.website)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm text-blue-300 underline-offset-4 hover:underline"><span className="break-all">{lab.dashboard.business.website}</span><ArrowUpRight className="shrink-0" size={16} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : <p className="mt-2 break-all text-sm text-secondary">{lab.dashboard.business.website}</p>}
              <p className="mt-3 text-xs leading-5 text-muted">Showing results collected: {formatTime(lab.displayedAudit?.completedAt)}{lab.displayedAudit?.strategy ? ` · ${lab.displayedAudit.strategy}` : ''}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end xl:flex-col xl:items-stretch">
              <div className="flex flex-wrap gap-3">
                <label htmlFor="lab-scope" className="text-xs font-medium text-secondary">Investigation
                  <select id="lab-scope" data-testid="lab-scope" value={scope} disabled={busy} onChange={(event) => setScope(event.target.value as Exclude<AuditScope, 'demo'>)} className="mt-1 block min-h-11 rounded-lg border border-line bg-canvas px-3 text-sm text-ink disabled:opacity-60"><option value="lighthouse">Homepage + Lighthouse</option><option value="homepage">Homepage HTML only</option></select>
                </label>
                <label htmlFor="lab-strategy" className="text-xs font-medium text-secondary">Device
                  <select id="lab-strategy" data-testid="lab-strategy" value={strategy} disabled={busy || scope !== 'lighthouse'} onChange={(event) => setStrategy(event.target.value as LighthouseStrategy)} className="mt-1 block min-h-11 rounded-lg border border-line bg-canvas px-3 text-sm text-ink disabled:opacity-60"><option value="mobile">Mobile</option><option value="desktop">Desktop</option></select>
                </label>
              </div>
              <button data-testid="lab-run-audit" type="button" onClick={() => void lab.startAudit(scope, strategy)} disabled={busy || lab.loading || Boolean(lab.error)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{busy ? 'Investigation in progress' : 'Run Investigation'}
              </button>
            </div>
          </div>
          <p className="mt-5 border-t border-line pt-3 text-xs leading-5 text-muted">{lab.dashboard.notice} No website changes are applied by this page.</p>
        </section>

        <section data-testid="lab-status-panel" aria-labelledby="lab-status-title" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="lab-status-title" className="text-base font-semibold text-ink">Investigation status</h2>
            <button data-testid="lab-refresh" type="button" onClick={() => void lab.refresh()} disabled={lab.loading || lab.submitting} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-secondary hover:bg-elevated disabled:opacity-60"><RefreshCw size={15} aria-hidden="true" />Refresh status</button>
          </div>
          <div role="status" aria-live="polite" className="mt-4 text-sm leading-6 text-secondary">
            <p className="flex flex-wrap items-center gap-2">{busy && <LoaderCircle size={17} className="motion-safe:animate-spin" aria-hidden="true" />}<span>{current ? stageLabels[current.stage] ?? current.stage : 'No investigation has been run.'}</span>{current && <StatusBadge label={current.status === 'partial' ? 'Partial results' : current.status === 'completed' ? 'Completed' : current.status === 'failed' ? 'Failed' : current.status === 'queued' ? 'Queued' : 'Running'} tone={current.status === 'failed' ? 'critical' : current.status === 'partial' ? 'medium' : 'blue'} />}</p>
            {busy && <p className="mt-2 text-xs text-muted">{lab.error ? 'Progress checks are paused. Retry the connection to resume.' : 'Checking progress every 2.5 seconds. Lighthouse can take around a minute. Previous results remain visible while this investigation runs.'}</p>}
            {current?.failure && <p className="mt-3 break-words text-amber-200">{current.failure.message} <span className="text-xs">({current.failure.code})</span></p>}
            {current?.status === 'partial' && <p className="mt-2 text-xs text-muted">{lab.displayedAudit?.id === current.id ? 'The available results are shown below. Unavailable Lighthouse scores stay blank.' : 'This audit is partially complete, but its report has not loaded. The previous results remain visible; retry the connection to load the new report.'}</p>}
            {current?.status === 'failed' && lab.displayedAudit && current.id !== lab.displayedAudit.id && <p className="mt-2 text-xs text-muted">The failed attempt did not replace the previous results shown below.</p>}
            {current && <p className="mt-3 break-all text-xs text-muted">Audit {current.id} · Started {formatTime(current.startedAt)}</p>}
          </div>
          {warnings.length > 0 && <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer text-sm font-medium text-secondary">Coverage and warnings ({warnings.length})</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-muted">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
        </section>

        <LighthouseResults report={lab.lighthouse} simulated={simulated} />

        <section aria-labelledby="lab-coverage-title" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="lab-coverage-title" className="text-base font-semibold text-ink">Audit coverage</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div><h3 className="text-sm font-medium text-secondary">Overall SEO Spy score</h3><p className="mt-2 text-sm text-muted">Unavailable · Combined scoring is not defined.</p></div>
            <div><h3 className="text-sm font-medium text-secondary">Social presence</h3><p className="mt-2 text-sm text-muted">Unavailable · No Facebook analysis was performed.</p></div>
            <div><h3 className="text-sm font-medium text-secondary">Evidence collected</h3><p className="mt-2 text-sm text-muted">{lab.evidence.length} evidence records · {simulated ? 'Simulated' : 'From the displayed audit'}</p></div>
          </div>
        </section>

        <AuditFindings findings={lab.findings} evidence={lab.evidence} recommendations={lab.recommendations} simulated={simulated} />
      </>}
    </div>
  )
}
