import { ArrowUpRight, LoaderCircle, Play } from 'lucide-react'
import { AssetGroup } from '../../components/dashboard/AssetGroup'
import { WebsiteHealth } from '../../components/dashboard/WebsiteHealth'
import { SocialPerformance } from '../../components/dashboard/SocialPerformance'
import { MainSpyScore } from '../../components/dashboard/MainSpyScore'
import { BusinessConsistency } from '../../components/dashboard/BusinessConsistency'
import { InvestigationStatus } from '../../components/dashboard/InvestigationStatus'
import { FindingCard } from '../../components/findings/FindingCard'
import { StatusBadge } from '../../components/common/StatusBadge'
import { mockBusiness, mockConnections } from '../../data/mockBusiness'
import { mockWebsiteResults, mockSocialResults, mockConsistency, mockMainSpyResults } from '../../data/mockResults'
import { mockFindings } from '../../data/mockFindings'
import { mockRecommendations } from '../../data/mockRecommendations'
import { useInvestigation } from '../../hooks/useInvestigation'

export function Dashboard() {
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
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary"><span>{websites.length} website{websites.length === 1 ? '' : 's'} connected</span><span>{socialAccounts.length} social account{socialAccounts.length === 1 ? '' : 's'} connected</span></p>
          </div>
          <button data-testid="dashboard-run-audit" type="button" onClick={() => void investigation.start()} disabled={investigation.busy || Boolean(investigation.error)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 xl:self-auto">
            {investigation.busy ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{investigation.submitting ? 'Starting investigation…' : investigation.loading ? 'Checking investigation…' : investigation.busy ? 'Investigation running…' : 'Run Investigation'}
          </button>
        </div>
        <div className="mt-5 border-t border-line pt-3 text-xs leading-5 text-muted">
          Run Investigation starts a real website audit. The connections, scores, findings, and recommendations shown below are still illustrative. Investigation reports are not displayed on this dashboard yet.
        </div>
        <InvestigationStatus audit={investigation.audit} loading={investigation.loading} submitting={investigation.submitting} error={investigation.error} onRetry={investigation.retry} />
      </section>

      <MainSpyScore results={mockMainSpyResults} />

      <BusinessConsistency results={mockConsistency} />

      <section aria-labelledby="results-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 id="results-title" className="text-base font-semibold text-ink">Current Results</h2><p className="text-xs text-muted">Illustrative data · Not a live assessment</p></div>
        <div className="grid gap-5 lg:grid-cols-2">
          <WebsiteHealth results={mockWebsiteResults} />
          <SocialPerformance results={mockSocialResults} />
        </div>
      </section>

      <section aria-labelledby="connections-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="connections-title" className="text-base font-semibold text-ink">Connected assets</h2><span className="text-xs text-muted">Demo connections · Add actions unavailable</span></div>
        <div className="grid gap-4 xl:grid-cols-2">
          <AssetGroup title="Websites" action="Add website" connections={websites} />
          <AssetGroup title="Social Media" action="Connect social account" connections={socialAccounts} />
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section aria-labelledby="findings-title" className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4 sm:px-6">
            <h2 id="findings-title" className="text-base font-semibold text-ink">Priority Findings</h2>
            <StatusBadge label={`${mockFindings.length} mock findings`} theme="dark" />
          </div>
          <div className="divide-y divide-line">{mockFindings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>
        </section>

        <section aria-labelledby="recommendations-title" className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-5 py-4 sm:px-6">
            <h2 id="recommendations-title" className="text-base font-semibold text-ink">Top Recommendations</h2>
            <p className="mt-1 text-sm text-secondary">Suggested next steps from the mock findings.</p>
          </div>
          <ol className="divide-y divide-line">
            {mockRecommendations.map((recommendation, index) => (
              <li key={recommendation.id} className="flex gap-3 px-5 py-4 sm:px-6">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-blue-300">{index + 1}</span>
                <div>
                  <h3 className="text-sm font-semibold leading-6 text-ink">{recommendation.title}</h3>
                  <p className="mt-1 text-sm leading-5 text-secondary">{recommendation.explanation}</p>
                  <p className="mt-2 text-xs text-secondary">{recommendation.source} · {recommendation.status}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
