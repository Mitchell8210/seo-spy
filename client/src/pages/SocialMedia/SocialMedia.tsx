import { useSearchParams } from 'react-router'
import { LoaderCircle, Play } from 'lucide-react'
import { FacebookMark } from '../../components/common/FacebookMark'
import { StatusBadge } from '../../components/common/StatusBadge'
import { SocialScoreHero } from '../../components/socialMedia/SocialScoreHero'
import { SocialHealthCard } from '../../components/socialMedia/SocialHealthCard'
import { SocialMediaReport } from '../../components/socialMedia/SocialMediaReport'
import { mockBusiness } from '../../data/mockBusiness'
import { useFacebookReport } from '../../hooks/useFacebookReport'
import { useFacebookReportRun } from '../../hooks/useFacebookReportRun'
import { mapSocialMediaReport } from '../../services/socialMediaMapping'

export function SocialMedia() {
  const [search] = useSearchParams()
  const businessId = search.get('businessId')?.trim() || mockBusiness.id
  const state = useFacebookReport(businessId)
  const report = state.data?.report
  const view = state.data ? mapSocialMediaReport(state.data) : null
  const run = useFacebookReportRun(businessId, view?.facebook.pageId ?? '', state.refresh)

  return (
    <div className="space-y-10">
      <div><h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Social Media</h1><p className="mt-2 text-sm leading-6 text-secondary">See how people find, follow, and connect with your business.</p></div>
      <section aria-label="Selected social account" className="rounded-2xl border border-line bg-surface p-5 shadow-lg shadow-black/10 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 sm:w-full sm:max-w-lg"><label htmlFor="social-account" className="mb-2 block text-sm font-medium text-secondary">Selected account</label><select key={view?.facebook.pageId ?? ''} id="social-account" defaultValue={view?.facebook.pageId ?? ''} disabled={!view} className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink">{view ? <option value={view.facebook.pageId}>Facebook — {view.facebook.pageName}</option> : <option value="">No saved Facebook account report</option>}</select></div>
          <button data-testid="social-run-report" type="button" onClick={() => void run.start()} disabled={!view || state.loading || run.running} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
            {run.running ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{run.running ? 'Report running…' : 'Run Report'}
          </button>
        </div>
        {view && <div className="mt-5 flex items-start gap-3"><FacebookMark /><div className="min-w-0"><p className="text-xs font-medium text-blue-300">Facebook</p><h2 className="mt-1 break-words text-lg font-semibold text-ink">{view.facebook.pageName}</h2><div className="mt-2"><StatusBadge label={report?.audit.status === 'partial' ? 'Partial coverage' : 'Saved report'} tone={report?.audit.status === 'partial' ? 'medium' : 'neutral'} /></div></div></div>}
        <p className="mt-4 border-t border-line pt-4 text-xs leading-6 text-muted">{view ? 'Saved Facebook report. Information reflects what was available when the report was collected.' : 'Connect a Facebook Page and generate a report to see its live data here.'}</p>
        {report && view && <p className="mt-1 text-xs leading-6 text-muted">Analyzed time: <time dateTime={report.generatedAt}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(report.generatedAt))} Pacific</time></p>}
      </section>
      {(run.error || state.error) && <p role="alert" className="rounded-xl border border-line bg-surface p-6 text-sm text-secondary">{run.error ?? state.error}</p>}
      {state.loading && !state.data && <p role="status" className="rounded-xl border border-line bg-surface p-6 text-sm text-secondary">Loading your saved Facebook report…</p>}
      {!state.loading && !state.error && !report && <p role="status" className="rounded-xl border border-line bg-surface p-6 text-sm text-secondary">No saved Facebook analysis is available for this account.</p>}
      {report && view && <div data-testid="social-report" className="space-y-10">
        <SocialScoreHero score={null} summary={view.scoreSummary} benchmark={null} mode="live" />
        <section aria-labelledby="social-health-title">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3"><h2 id="social-health-title" className="text-xl font-semibold tracking-tight text-ink">Social Media Health Summary</h2><span className="rounded-md border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-secondary">{view.periodLabel} · Saved live data</span></div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">{view.healthMetrics.map(metric => <SocialHealthCard key={metric.id} metric={metric} />)}</div>
        </section>
        <SocialMediaReport key={report.auditId} findings={view.findings} checks={[]} mode="live" evidenceLabel={view.evidenceLabel} />
      </div>}
    </div>
  )
}
