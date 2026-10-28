import { useState } from 'react'
import { ArrowUpRight, Globe } from 'lucide-react'
import { WebsiteHealth } from '../../components/dashboard/WebsiteHealth'
import { ScoreCard } from '../../components/dashboard/ScoreCard'
import { StatusBadge } from '../../components/common/StatusBadge'
import { WebsiteSelector } from '../../components/website/WebsiteSelector'
import { WebsiteFindings } from '../../components/website/WebsiteFindings'
import { mockWebsites, mockWebsiteAudits } from '../../data/mockWebsiteAudits'

export function Website() {
  const [selectedId, setSelectedId] = useState(mockWebsites[0]?.id ?? '')
  const website = mockWebsites.find((item) => item.id === selectedId)
  const audit = mockWebsiteAudits.find((item) => item.websiteId === selectedId)

  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Website</h1><p className="mt-2 text-sm leading-6 text-secondary">Understand your website’s health, evidence, and next steps.</p></div>
      <section aria-label="Selected website" className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
        <WebsiteSelector websites={mockWebsites} selectedId={selectedId} onSelect={setSelectedId} />
        {website && <div className="mt-4 flex flex-wrap items-center gap-3"><StatusBadge label={website.status} tone="success" /><a href={website.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-sm text-blue-300 underline-offset-4 hover:underline"><Globe size={16} className="shrink-0" aria-hidden="true" /><span className="break-all">{website.url}</span><ArrowUpRight size={15} className="shrink-0" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div>}
        <p className="mt-4 border-t border-line pt-4 text-xs leading-6 text-muted">Mock analysis only. Scores, evidence, and page details are illustrative; no live scan or Lighthouse run has been performed.</p>
        {audit && <p className="mt-1 text-xs leading-6 text-muted">Sample analyzed time: <time dateTime={audit.analyzedAt}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(audit.analyzedAt))} Pacific</time></p>}
      </section>
      {audit ? <>
        <section aria-labelledby="website-summary-title">
          <h2 id="website-summary-title" className="mb-4 text-lg font-semibold text-ink">Website Health Summary</h2>
          <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6"><h3 className="mb-5 text-base font-semibold text-ink">{audit.results.overall.label}</h3><ScoreCard score={audit.results.overall} prominent /><p className="mt-4 text-xs text-muted">Mock score · Same as Dashboard</p></div>
            <WebsiteHealth results={audit.results} />
          </div>
        </section>
        <WebsiteFindings key={audit.id} findings={audit.findings} pages={audit.pages} passedChecks={audit.passedChecks} passedTotal={audit.results.checksPassed} recommendations={audit.recommendations} />
      </> : <p role="status" className="rounded-xl border border-line bg-surface p-6 text-sm text-secondary">No mock analysis is available for this website.</p>}
    </div>
  )
}
