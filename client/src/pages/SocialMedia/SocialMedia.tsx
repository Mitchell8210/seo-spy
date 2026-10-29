import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { FacebookMark } from '../../components/common/FacebookMark'
import { StatusBadge } from '../../components/common/StatusBadge'
import { SocialScoreHero } from '../../components/socialMedia/SocialScoreHero'
import { SocialHealthCard } from '../../components/socialMedia/SocialHealthCard'
import { SocialMediaReport } from '../../components/socialMedia/SocialMediaReport'
import { mockSocialAccounts, mockSocialMediaAudits, mockSocialBenchmark } from '../../data/mockSocialMediaAudits'

export function SocialMedia() {
  const [selectedId, setSelectedId] = useState(mockSocialAccounts[0]?.id ?? '')
  const account = mockSocialAccounts.find((item) => item.id === selectedId)
  const audit = mockSocialMediaAudits.find((item) => item.accountId === selectedId)
  return (
    <div className="space-y-10">
      <div><h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Social Media</h1><p className="mt-2 text-sm leading-6 text-secondary">See how people find, follow, and connect with your business.</p></div>
      <section aria-label="Selected social account" className="rounded-2xl border border-line bg-surface p-5 shadow-lg shadow-black/10 sm:p-7">
        <div className="max-w-lg"><label htmlFor="social-account" className="mb-2 block text-sm font-medium text-secondary">Selected account</label><select id="social-account" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink">{mockSocialAccounts.map((item) => <option key={item.id} value={item.id}>{item.platform} — {item.name}</option>)}</select></div>
        {account && <div className="mt-5 flex items-start gap-3">{account.platform === 'Facebook' ? <FacebookMark /> : <Share2 size={24} aria-hidden="true" />}<div className="min-w-0"><p className="text-xs font-medium text-blue-300">{account.platform}</p><h2 className="mt-1 break-words text-lg font-semibold text-ink">{account.name}</h2><div className="mt-2"><StatusBadge label={account.status} tone="success" /></div></div></div>}
        <p className="mt-4 border-t border-line pt-4 text-xs leading-6 text-muted">Mock analysis only. Numbers and findings are examples, not live Facebook results. Available information may differ when an account is connected in the future.</p>
        {audit && <p className="mt-1 text-xs leading-6 text-muted">Sample analyzed time: <time dateTime={audit.analyzedAt}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(audit.analyzedAt))} Pacific</time></p>}
      </section>
      {audit ? <>
        <SocialScoreHero score={audit.score} summary={audit.scoreSummary} benchmark={mockSocialBenchmark} />
        <section aria-labelledby="social-health-title">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3"><h2 id="social-health-title" className="text-xl font-semibold tracking-tight text-ink">Social Media Health Summary</h2><span className="rounded-md border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-secondary">{audit.periodLabel} · Mock data</span></div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">{audit.healthMetrics.map((metric) => <SocialHealthCard key={metric.id} metric={metric} />)}</div>
        </section>
        <SocialMediaReport key={audit.id} findings={audit.findings} checks={audit.passedChecks} />
      </> : <p role="status" className="rounded-xl border border-line bg-surface p-6 text-sm text-secondary">No mock analysis is available for this account.</p>}
    </div>
  )
}
