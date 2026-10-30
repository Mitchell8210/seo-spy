import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowUpRight, Globe, LoaderCircle, Play } from 'lucide-react'
import { WebsiteHealth } from '../../components/dashboard/WebsiteHealth'
import { ScoreCard } from '../../components/dashboard/ScoreCard'
import { StatusBadge } from '../../components/common/StatusBadge'
import { WebsiteSelector } from '../../components/website/WebsiteSelector'
import { WebsiteFindings } from '../../components/website/WebsiteFindings'
import { mockBusiness } from '../../data/mockBusiness'
import { useWebsiteReport } from '../../hooks/useWebsiteReport'
import { useInvestigation } from '../../hooks/useInvestigation'
import { mapWebsiteReport, measurementLabel } from '../../services/websiteMapping'
import type { ConnectedWebsite } from '../../types/website'

export function Website() {
  const [search, setSearch] = useSearchParams()
  const businessId = search.get('businessId')?.trim() || mockBusiness.id
  const state = useWebsiteReport(businessId)
  const investigation = useInvestigation(businessId)
  const refresh = state.refresh
  useEffect(() => { refresh() }, [refresh, investigation.audit?.id, investigation.audit?.status])
  async function runReport() {
    if (investigation.error) await investigation.retry()
    await investigation.start()
    refresh()
  }
  const record = state.report
  const audit = record ? mapWebsiteReport(record) : null
  const business = record?.business ?? state.dashboard?.business
  const connection = state.dashboard?.connections.find(item => item.platform === 'website' && item.mode === 'live')
  const website: ConnectedWebsite | null = business ? {
    id: business.id, domain: new URL(business.website).hostname, url: business.website,
    status: record ? 'Saved report' : connection ? ({ connected: 'Connected', disconnected: 'Not connected', authorization_required: 'Needs attention', checking: 'Checking', error: 'Error' } as const)[connection.status] : 'Not available',
  } : null
  const active = investigation.audit?.status === 'queued' || investigation.audit?.status === 'running'
    ? investigation.audit : state.dashboard?.activeAudit
  const running = active?.mode === 'live' && (active.scope === 'homepage' || active.scope === 'lighthouse') ? active : null
  const coverage = record?.results?.lighthouse
    ? `Saved homepage HTML audit plus ${measurementLabel(record.results.lighthouse)}. Lab results do not establish field Core Web Vitals or accessibility compliance.`
    : record ? 'Saved homepage HTML audit only. Lighthouse measurements and passed-check totals are not available.'
      : 'No saved website analysis is available for this website.'
  const notice = [coverage, record?.audit.status === 'partial' ? 'Partial coverage.' : '',
    ...(record?.audit.warnings ?? []), record?.audit.failure?.message ?? '',
    running ? `Investigation ${running.status}: ${running.stage.replaceAll('_', ' ')}. Previous results remain visible.` : '',
    state.latestAttempt?.status === 'failed' ? 'The latest website investigation failed. Previous saved results remain visible when available.' : '',
    investigation.error?.message ?? '', state.error ?? ''].filter(Boolean).join(' ')
  const evidenceLabel = record?.results?.lighthouse ? measurementLabel(record.results.lighthouse) : 'Saved live homepage HTML evidence · Collection source and time shown above'

  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Website</h1><p className="mt-2 text-sm leading-6 text-secondary">Understand your website’s health, evidence, and next steps.</p></div>
      <section aria-label="Selected website" className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 sm:w-full sm:max-w-md"><WebsiteSelector websites={website ? [website] : []} selectedId={website?.id ?? ''} onSelect={(id) => { if (id !== businessId) { const next = new URLSearchParams(search); next.set('businessId', id); setSearch(next) } }} /></div>
          <button data-testid="website-run-report" type="button" onClick={() => void runReport()} disabled={!website || (investigation.busy && !investigation.error)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
            {investigation.busy && !investigation.error ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{investigation.submitting ? 'Starting report…' : investigation.loading ? 'Checking report…' : investigation.busy && !investigation.error ? 'Report running…' : 'Run Report'}
          </button>
        </div>
        {website && <div className="mt-4 flex flex-wrap items-center gap-3"><StatusBadge label={website.status} tone={website.status === 'Connected' || website.status === 'Saved report' ? 'success' : 'neutral'} /><a href={website.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-sm text-blue-300 underline-offset-4 hover:underline"><Globe size={16} className="shrink-0" aria-hidden="true" /><span className="break-all">{website.url}</span><ArrowUpRight size={15} className="shrink-0" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div>}
        <p className="mt-4 border-t border-line pt-4 text-xs leading-6 text-muted">{state.loading && !record ? 'Loading your saved website report...' : notice}</p>
        {audit && <p className="mt-1 text-xs leading-6 text-muted">Analyzed time: <time dateTime={audit.analyzedAt}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(audit.analyzedAt))} Pacific</time></p>}
      </section>
      {audit ? <>
        <section aria-labelledby="website-summary-title">
          <h2 id="website-summary-title" className="mb-4 text-lg font-semibold text-ink">Website Health Summary</h2>
          <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6"><h3 className="mb-5 text-base font-semibold text-ink">{audit.results.overall.label}</h3><ScoreCard score={audit.results.overall} prominent live /><p className="mt-4 text-xs text-muted">Not available · Combined scoring is not implemented</p></div>
            <WebsiteHealth results={audit.results} live />
          </div>
        </section>
        <WebsiteFindings live evidenceLabel={evidenceLabel} key={audit.id} findings={audit.findings} pages={audit.pages} passedChecks={audit.passedChecks} passedTotal={audit.results.checksPassed} recommendations={audit.recommendations} />
      </> : <p role={state.error ? 'alert' : 'status'} className="rounded-xl border border-line bg-surface p-6 text-sm text-secondary">{state.error ?? (state.loading ? 'Loading your saved website report...' : running ? 'Your website investigation is running. Results will appear when it finishes.' : 'No saved website analysis is available for this website.')}</p>}
    </div>
  )
}
