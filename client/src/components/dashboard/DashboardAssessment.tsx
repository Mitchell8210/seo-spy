import { useState } from 'react'
import { CircleAlert, Monitor, Store, WandSparkles } from 'lucide-react'
import { Link } from 'react-router'
import { mockBusiness } from '../../data/mockBusiness'
import { mockConsistency, mockMainSpyResults, mockWebsiteResults } from '../../data/mockResults'
import { mockFindings } from '../../data/mockFindings'
import { useFacebookReport } from '../../hooks/useFacebookReport'
import { mapSocialMediaReport } from '../../services/socialMediaMapping'
import type { Score } from '../../types/dashboard'
import { FacebookMark } from '../common/FacebookMark'
import { SpyLogo } from '../common/SpyLogo'
import { ScoreCard } from './ScoreCard'
import { getScoreStatus } from '../../utils/scoreStatus'
import type { ReactNode } from 'react'

interface Issue { id: string; title: string; explanation: string; severity: string }
const priority: Record<string, number> = { Critical: 0, Medium: 1, Low: 2 }
const buttonStyle = 'inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 py-2 text-[11px] font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300'
const reportStyle = 'mt-auto inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-400/40 px-2 py-2 text-center text-xs font-semibold text-blue-200 hover:bg-blue-500/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300'

function CategoryScore({ score }: { score: Score | null }) {
  const fraction = score ? Math.max(0, Math.min(1, score.value / score.maximum)) : 0
  const status = score ? getScoreStatus(fraction * 100) : null
  return <div className="flex min-h-24 items-center gap-3" aria-label={score ? `${score.label}: ${score.value} out of ${score.maximum}, ${status?.label}` : 'Score: not available'}>
    <svg viewBox="0 0 80 80" className="size-16 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="40" cy="40" r="33" fill="none" strokeWidth="6" className="stroke-line" />
      {score && <circle cx="40" cy="40" r="33" fill="none" strokeWidth="6" stroke="currentColor" pathLength="100" strokeDasharray={`${fraction * 100} 100`} strokeLinecap="round" className={status?.dark} />}
    </svg>
    <div className="min-w-0"><p className="text-3xl font-semibold tracking-tight text-ink">{score?.value ?? '—'}{score && <span className="ml-1 text-xs font-normal text-muted">/{score.maximum}</span>}</p><p className={`mt-1 inline-block rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold ${status?.dark ?? 'text-muted'}`}>{status?.label ?? 'Not available'}</p></div>
  </div>
}

function Category({ title, description, icon, score, source, issues, empty, children, accent }: {
  title: string; description: string; icon: ReactNode; score: Score | null; source: string;
  issues: Issue[]; empty: string; children: ReactNode; accent: string
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const topIssues = [...issues].sort((a, b) => (priority[a.severity] ?? 3) - (priority[b.severity] ?? 3)).slice(0, 3)
  return <section aria-label={title} className="flex min-w-0 flex-col rounded-xl border border-line bg-elevated/50 p-3">
    <div className="flex min-h-14 items-center gap-2"><span className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${accent}`}>{icon}</span><h3 className="text-sm font-semibold leading-5 text-ink">{title}</h3></div>
    <p className="mt-2 min-h-[60px] text-xs leading-5 text-secondary">{description}</p>
    <CategoryScore score={score} />
    <p className="mb-4 min-h-10 text-[10px] leading-4 text-muted">{source}</p>
    <h4 className="mb-3 text-xs font-semibold text-ink">Top issues to fix now</h4>
    {topIssues.length ? <ul className="mb-4 space-y-2">{topIssues.map(issue => {
      const tone = issue.severity === 'Critical' ? 'border-red-400/20 bg-red-400/10 text-red-300' : issue.severity === 'Medium' ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      return <li key={issue.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2 sm:flex-nowrap">
        <span title={issue.severity} className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${tone}`}><CircleAlert size={14} aria-hidden="true" /><span className="sr-only">{issue.severity} · Needs review</span></span>
        <div className="min-w-0 flex-1"><h5 className="break-words text-xs font-semibold leading-4 text-ink">{issue.title}</h5><p title={issue.explanation} className="mt-1 truncate text-[10px] leading-4 text-secondary">{issue.explanation}</p></div>
        <button type="button" aria-label={`Fix with AI: ${issue.title}`} className={`${buttonStyle} shrink-0`} onClick={() => setFeedback(`Demo preview for “${issue.title}”. Review the full report before deciding on a change. No changes have been made.`)}><WandSparkles size={12} aria-hidden="true" />Fix with AI</button>
      </li>
    })}</ul> : <p className="mb-4 rounded-lg border border-line p-3 text-xs leading-5 text-secondary">{empty}</p>}
    <p role="status" aria-live="polite" className="break-words text-xs leading-5 text-blue-200">{feedback}</p>
    <div className="mt-auto flex flex-col pt-3">{children}</div>
  </section>
}

export function DashboardAssessment() {
  const social = useFacebookReport(mockBusiness.id)
  const socialView = social.data ? mapSocialMediaReport(social.data) : null
  const consistencyIssues = mockConsistency.checks.filter(check => !check.matches).map(check => ({
    id: check.id, title: check.label, severity: 'Medium', explanation: `Website: ${check.website}. Facebook: ${check.social}.`,
  }))
  return <section aria-labelledby="spy-total-title" className="min-w-0 rounded-2xl border border-blue-500/60 bg-surface p-3 shadow-lg shadow-blue-950/20 sm:p-5">
    <div className="flex items-center gap-3"><SpyLogo /><div><p className="text-xs font-semibold text-blue-300">SEO Spy</p><h2 id="spy-total-title" className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">Spy Total Score</h2></div></div>
    <div className="mt-5 grid min-w-0 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-[1.08fr_1fr_1fr_1fr]">
      <section aria-label="Overall assessment" className="flex min-w-0 flex-col rounded-xl border border-blue-400/20 bg-blue-500/[0.03] p-4 md:col-span-2 xl:col-span-1">
        <ScoreCard score={mockMainSpyResults.overall} prominent />
        <p className="mt-4 text-xs leading-5 text-secondary">SEO Spy combines your website health, social media performance, and business consistency to give you one overall view of your online presence.</p>
        <p className="mt-2 text-[10px] leading-4 text-muted">Demo overall score · Not calculated from the saved Facebook report. Website and consistency scores are also demo data.</p>
        <dl className="mt-auto space-y-3 border-t border-line pt-4 text-[11px]">
          {[
            { label: 'Website Health', score: mockWebsiteResults.overall, dot: 'bg-cyan-400' },
            { label: 'Social Media Performance', score: null, dot: 'bg-blue-500' },
            { label: 'Business Consistency', score: mockConsistency.score, dot: 'bg-amber-400' },
          ].map(item => <div key={item.label} className="flex items-start justify-between gap-2"><dt className="flex min-w-0 items-start gap-2 text-secondary"><span className={`mt-1 size-1.5 shrink-0 rounded-full ${item.dot}`} aria-hidden="true" />{item.label}</dt><dd className="shrink-0 text-right font-semibold text-ink">{item.score ? `${item.score.value}/${item.score.maximum}` : <><span aria-hidden="true">—</span><span className="block text-[10px] font-normal text-muted">Not available</span></>}</dd></div>)}
        </dl>
      </section>
      <Category accent="border-cyan-400/30 bg-cyan-400/15 text-cyan-300" title="Website Health" description="How your website performs for search engines and visitors." icon={<Monitor size={25} aria-hidden="true" />} score={mockWebsiteResults.overall} source="Demo score and findings · Not a live assessment" issues={mockFindings.filter(finding => finding.source === 'Website')} empty="No website issues are listed in the current demo data.">
        <Link to="/website" className={reportStyle}>Open Website Report</Link>
      </Category>
      <Category accent="border-blue-400/40 bg-blue-600 text-white" title="Social Media Performance" description="How your social presence and activity support your business." icon={<FacebookMark />} score={null} source={socialView ? `Saved Facebook report · ${socialView.facebook.pageName} · Numeric score not provided` : 'Numeric social score not available'} issues={socialView?.findings ?? []} empty={social.loading ? 'Loading your saved Facebook report…' : social.error ? social.error : socialView ? 'No issues were found in the saved checks. Coverage may be limited; review the full report.' : 'No saved Facebook report is available. Connect a Page and generate a report to see its findings.'}>
        {social.error && <button type="button" onClick={social.refresh} className={`${reportStyle} mb-3`}>Retry saved report</button>}
        <Link to="/social-media" className={reportStyle}>Open Social Media Report</Link>
      </Category>
      <Category accent="border-amber-400/30 bg-amber-400/15 text-amber-300" title="Business Consistency" description="How consistent your business information is across connected platforms." icon={<Store size={25} aria-hidden="true" />} score={mockConsistency.score} source={`Demo comparison · ${mockConsistency.channels}`} issues={consistencyIssues} empty="No differences are listed in the current demo comparison.">
        <details className="mt-auto rounded-lg border border-blue-400/40 text-xs text-blue-200"><summary className="min-h-[42px] cursor-pointer rounded-lg px-2 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-blue-300">View Consistency Details</summary><ul className="space-y-4 border-t border-line p-3">{mockConsistency.checks.map(check => <li key={check.id} className="break-words text-xs leading-5"><p className="font-semibold text-ink">{check.label} · {check.matches ? 'Matches' : 'Needs review'}</p><p>Website: {check.website}</p><p>Facebook: {check.social}</p></li>)}</ul></details>
      </Category>
    </div>
  </section>
}
