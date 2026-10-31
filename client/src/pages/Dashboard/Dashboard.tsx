import { useEffect, useId, useRef } from 'react'
import { ArrowRight, ArrowUpRight, CircleAlert, ChevronRight, Info, LoaderCircle, Play, Target } from 'lucide-react'
import { Link } from 'react-router'
import { InvestigationStatus } from '../../components/dashboard/InvestigationStatus'
import { findingStatuses } from '../../utils/findingStatus'
import { StatusBadge } from '../../components/common/StatusBadge'
import { mockBusiness, mockConnections } from '../../data/mockBusiness'
import { DashboardAssessment } from '../../components/dashboard/DashboardAssessment'
import { opportunityTitle } from '../../services/dashboardOpportunityCopy'
import { useDashboardAssessment } from '../../hooks/useDashboardAssessment'
import { useInvestigation } from '../../hooks/useInvestigation'

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
}

function DataDisclosure() {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLSpanElement>(null)
  const escapeDismissed = useRef(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelDismiss = () => clearTimeout(dismissTimer.current)
  useEffect(() => () => clearTimeout(dismissTimer.current), [])

  function show() {
    escapeDismissed.current = false
    cancelDismiss()
    const panel = tooltip.current
    const button = trigger.current
    if (!panel || !button) return
    panel.showPopover()
    const rect = button.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - 32)
    panel.style.width = `${width}px`
    panel.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))}px`
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8))}px`
  }

  function dismissAfterHover() {
    cancelDismiss()
    dismissTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) tooltip.current?.hidePopover()
    }, 150)
  }

  return <span className="inline" onPointerEnter={event => { if (event.pointerType === 'mouse') show() }} onPointerLeave={dismissAfterHover}>
    <button ref={trigger} type="button" aria-label="Important data disclosure" aria-describedby={id} onFocus={() => { if (!escapeDismissed.current) show() }} onBlur={() => { cancelDismiss(); tooltip.current?.hidePopover(); escapeDismissed.current = false }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); escapeDismissed.current = true; cancelDismiss(); tooltip.current?.hidePopover() } }} onClick={show} className="ml-1 inline-flex size-7 items-center justify-center rounded-md align-middle text-muted hover:text-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"><Info size={15} aria-hidden="true" /></button>
    <span ref={tooltip} id={id} role="tooltip" popover="auto" className="fixed inset-auto z-50 m-0 rounded-lg border border-line bg-elevated p-3 text-xs leading-5 text-secondary shadow-xl">Social findings come from saved Facebook reports. Website and Business Consistency data, the Spy Total Score, and the lower findings and recommendations are currently demo examples.</span>
  </span>
}

export function Dashboard() {
  const assessment = useDashboardAssessment()
  function openConsistency(category: string) {
    if (category !== 'consistency') return
    const details = document.getElementById('consistency-details') as HTMLDetailsElement | null
    if (details) {
      details.open = true
      details.focus()
      details.scrollIntoView({ block: 'center' })
    }
  }
  const investigation = useInvestigation(mockBusiness.id)

  const websites = mockConnections.filter((connection) => connection.platform === 'website')
  const socialAccounts = mockConnections.filter((connection) => connection.platform !== 'website')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Dashboard</h1>
        <p className="mt-2 text-sm leading-6 text-secondary">Your online performance, across every connected channel.</p>
      </div>

      <section aria-labelledby="business-title" className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-7">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-center">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge label={mockBusiness.status} />
            </div>
            <h2 id="business-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{mockBusiness.name}</h2>
            <a href={mockBusiness.website} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm text-blue-300 underline-offset-4 hover:underline">
              <span className="break-all">{new URL(mockBusiness.website).hostname}</span>
              <ArrowUpRight size={16} className="shrink-0" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary"><span>{websites.length} website{websites.length === 1 ? '' : 's'} connected</span><span>{socialAccounts.length} social account{socialAccounts.length === 1 ? '' : 's'} connected</span><Link to="/settings#connected-assets" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 font-medium text-blue-300 hover:text-blue-200 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">Manage Connections<ArrowRight size={14} aria-hidden="true" /></Link></div>
          </div>
          <button data-testid="dashboard-run-audit" type="button" onClick={() => void investigation.start()} disabled={investigation.busy || Boolean(investigation.error)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 xl:self-auto">
            {investigation.busy ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{investigation.submitting ? 'Starting investigation…' : investigation.loading ? 'Checking investigation…' : investigation.busy ? 'Investigation running…' : 'Run Investigation'}
          </button>
        </div>
        <div className="mt-5 border-t border-line pt-3 text-xs leading-5 text-muted">
          Run Investigation starts a website audit.<DataDisclosure />
        </div>
        <InvestigationStatus audit={investigation.audit} loading={investigation.loading} submitting={investigation.submitting} error={investigation.error} onRetry={investigation.retry} />
      </section>

      <DashboardAssessment model={assessment} />

      <section aria-labelledby="next-steps-title" className="overflow-hidden rounded-2xl border border-blue-500/40 bg-surface shadow-sm">
        <header className="border-b border-line px-5 py-5 sm:px-6">
          <h2 id="next-steps-title" className="text-xl font-semibold tracking-tight text-ink">Your Next Steps</h2>
          <p className="mt-2 text-sm leading-6 text-secondary">Additional opportunities and recommended actions to keep improving your online presence.</p>
        </header>
        <div className="grid divide-y divide-line lg:grid-cols-[1.1fr_0.9fr] lg:divide-x lg:divide-y-0">
          <section aria-labelledby="findings-title" className="min-w-0 px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="findings-title" className="flex items-center gap-2 text-base font-semibold text-ink"><CircleAlert size={18} className="text-amber-300" aria-hidden="true" />More Opportunities</h3>
              <StatusBadge label={`${assessment.remaining.length} ${assessment.remaining.length === 1 ? 'opportunity' : 'opportunities'}`} theme="dark" />
            </div>
            <p className="mt-2 text-xs leading-5 text-secondary">Other improvements worth reviewing.</p>
            <div className="mt-3 divide-y divide-line">{assessment.remaining.map(finding => <Link key={`${finding.category}:${finding.id}`} to={finding.destination} state={{ findingId: finding.id }} onClick={() => openConsistency(finding.category)} className="group relative block rounded-lg py-4 pr-6 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-400">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge label={finding.severity} tone={findingStatuses[finding.severity].tone} theme="dark" /><span className="text-xs font-medium text-secondary">{finding.source}</span></div>
              <h4 className="mt-2 text-sm font-semibold leading-6 text-ink">{opportunityTitle(finding.title, finding.explanation)}</h4>
              <p className="mt-1 text-sm leading-5 text-secondary">{finding.explanation}</p>
              <p className="mt-2 text-xs font-medium text-muted">{statusLabel(finding.status)} · {finding.mode === 'demo' ? 'Demo' : 'Saved Facebook report'}</p><ChevronRight size={16} className="absolute right-1 top-5 text-muted group-hover:text-blue-300" aria-hidden="true" />
            </Link>)}{assessment.remaining.length === 0 && <p className="py-4 text-sm leading-6 text-secondary">No additional opportunities are available in the current data. Review the priority issues above first.</p>}{assessment.social.loading && <p role="status" className="py-2 text-xs text-muted">Checking saved Facebook opportunities…</p>}{assessment.social.error && <p role="alert" className="py-2 text-xs text-muted">Saved Facebook opportunities could not be refreshed. Review Social Media for details.</p>}</div>
          </section>
          <section aria-labelledby="recommendations-title" className="min-w-0 px-5 py-5 sm:px-6">
            <h3 id="recommendations-title" className="flex items-center gap-2 text-base font-semibold text-ink"><Target size={18} className="text-blue-300" aria-hidden="true" />Recommended Path</h3>
            <p className="mt-2 text-xs leading-5 text-secondary">A simple order for continuing your optimization.</p>
            <ol className="mt-3 divide-y divide-line">
              {assessment.path.map((issue, index) => {
                const recommendation = issue.recommendation!
                return (
                <li key={`${issue.category}:${issue.id}`}><Link to={issue.destination} state={{ findingId: issue.id }} onClick={() => openConsistency(issue.category)} className="group flex min-h-11 items-start gap-3 rounded-lg py-4 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-blue-400">
                  <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-blue-300">{index + 1}</span>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold leading-6 text-ink">{recommendation.title}</h4>
                    <p className="mt-1 text-sm leading-5 text-secondary">{recommendation.explanation}</p>
                    <p className="mt-2 text-xs text-secondary">{issue.source} · {statusLabel(recommendation.status)}</p>
                  </div><ChevronRight size={16} className="mt-1 ml-auto shrink-0 text-muted group-hover:text-blue-300" aria-hidden="true" />
                </Link></li>
              )
              })}{assessment.path.length === 0 && <li className="py-4 text-sm leading-6 text-secondary">No additional recommended actions are available. Start with the priority issues above.</li>}
            </ol>
          </section>
        </div>
      </section>
    </div>
  )
}
