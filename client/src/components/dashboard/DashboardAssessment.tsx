import { useState } from 'react'
import { CircleAlert, Monitor, Store, WandSparkles } from 'lucide-react'
import { Link } from 'react-router'
import type { DashboardAssessmentModel } from '../../hooks/useDashboardAssessment'
import type { Score } from '../../types/dashboard'
import { FacebookMark } from '../common/FacebookMark'
import { SpyLogo } from '../common/SpyLogo'
import { ScoreCard } from './ScoreCard'
import { getScoreStatus } from '../../utils/scoreStatus'
import { useAnimatedScore } from '../../hooks/useAnimatedScore'
import type { ReactNode } from 'react'
import type { FixReviewRequest } from '../../types/fixReview'
import { RecommendedWordPressFixes } from './RecommendedWordPressFixes'
import { FixWithAIButton } from '../recommendations/FixWithAIButton'

interface Issue { id: string; title: string; explanation: string; severity: string; fixReview?: FixReviewRequest; recommendation?: { title: string; explanation: string } }
const buttonStyle = 'inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 py-2 text-[11px] font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300'
const reportStyle = 'mt-auto inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-400/40 px-2 py-2 text-center text-xs font-semibold text-blue-200 hover:bg-blue-500/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300'

function CategoryScore({ score }: { score: Score | null }) {
  const { ref: scoreRef, value: animatedValue, fraction: animatedFraction } = useAnimatedScore(score?.value ?? null, score?.maximum ?? 100)
  const animatedStatus = getScoreStatus(animatedFraction * 100)
  const fraction = score ? Math.max(0, Math.min(1, score.value / score.maximum)) : 0
  const status = score ? getScoreStatus(fraction * 100) : null
  return <div ref={scoreRef} className="flex min-h-24 items-center gap-3" aria-label={score ? `${score.label}: ${score.value} out of ${score.maximum}, ${status?.label}` : 'Score: not available'}>
    <svg viewBox="0 0 80 80" className="size-16 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="40" cy="40" r="33" fill="none" strokeWidth="6" className="stroke-line" />
      {score && <circle cx="40" cy="40" r="33" fill="none" strokeWidth="6" stroke="currentColor" pathLength="100" strokeDasharray={`${animatedFraction * 100} 100`} strokeLinecap="round" className={animatedStatus.dark} />}
    </svg>
    <div className="min-w-0"><p className="text-3xl font-semibold tracking-tight text-ink">{animatedValue ?? '—'}{score && <span className="ml-1 text-xs font-normal text-muted">/{score.maximum}</span>}</p><p className={`mt-1 inline-block rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold ${status?.dark ?? 'text-muted'}`}>{status?.label ?? 'Not available'}</p></div>
  </div>
}

function Category({ title, description, icon, score, source, issues, empty, children, accent, issuesContent }: {
  title: string; description: string; icon: ReactNode; score: Score | null; source: string;
  issues: Issue[]; empty: string; children: ReactNode; accent: string; issuesContent?: ReactNode
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const topIssues = issues
  return <section aria-label={title} className="flex min-w-0 flex-col rounded-xl border border-line bg-elevated/50 p-3">
    <div className="flex min-h-14 items-center gap-2"><span className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${accent}`}>{icon}</span><h3 className="text-sm font-semibold leading-5 text-ink">{title}</h3></div>
    <p className="mt-2 min-h-[60px] text-xs leading-5 text-secondary">{description}</p>
    <CategoryScore score={score} />
    <h4 className="mb-3 text-xs font-semibold text-ink">Top issues to fix now</h4>
    {issuesContent ?? (topIssues.length ? <ul className="mb-4 space-y-2">{topIssues.map(issue => {
      const tone = issue.severity === 'Critical' ? 'border-red-400/20 bg-red-400/10 text-red-300' : issue.severity === 'Medium' ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      if (title === 'Social Media Performance') return <li key={issue.id}>
        <FixWithAIButton iconOnly ariaLabel={`Fix with AI: ${issue.title}`}
          className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface p-2 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
          review={issue.fixReview ?? { id: issue.id, title: issue.title, explanation: issue.explanation, category: 'social', source, recommendation: issue.recommendation?.explanation }}>
          <span title={issue.severity} className={`flex size-10 shrink-0 items-center justify-center rounded border ${tone}`}><CircleAlert size={16} aria-hidden="true" /><span className="sr-only">{issue.severity} � Needs review</span></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold leading-4 text-ink">{issue.title}</span><span className="mt-1 line-clamp-2 text-[10px] leading-4 text-secondary">{issue.explanation}</span></span>
          <WandSparkles size={14} className="shrink-0 text-blue-300" aria-hidden="true" />
        </FixWithAIButton>
      </li>
      return <li key={issue.id} className="flex min-w-0 flex-wrap items-start gap-2 rounded-lg border border-line bg-surface p-2">
        <span title={issue.severity} className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${tone}`}><CircleAlert size={14} aria-hidden="true" /><span className="sr-only">{issue.severity} · Needs review</span></span>
        <div className="min-w-0 flex-1 basis-[calc(100%-2rem)]"><h5 className="break-words text-xs font-semibold leading-4 text-ink">{issue.title}</h5><p title={issue.explanation} className="mt-1 break-words text-[10px] leading-4 text-secondary">{issue.explanation}</p></div>
        <FixWithAIButton ariaLabel={`Fix with AI: ${issue.title}`} className={`${buttonStyle} ml-8 shrink-0`}
          review={issue.fixReview ?? { id: issue.id, title: issue.title, explanation: issue.explanation,
            category: title === 'Website Health' ? 'website' : title === 'Social Media Performance' ? 'social' : 'consistency',
            source, recommendation: issue.recommendation?.explanation }}
          onOpen={hasExecution => setFeedback(hasExecution ? 'Saved execution and verification results are available in the fix review.' : issue.recommendation ? `Saved recommendation: ${issue.recommendation.title}. ${issue.recommendation.explanation} Review the full report before approving a change. No changes have been made.` : `No saved recommendation is available for “${issue.title}”. Review the full report before deciding on a change. No changes have been made.`)}><WandSparkles size={12} aria-hidden="true" /></FixWithAIButton>
      </li>
    })}</ul> : <p className="mb-4 rounded-lg border border-line p-3 text-xs leading-5 text-secondary">{empty}</p>)}
    <p role="status" aria-live="polite" className="break-words text-xs leading-5 text-blue-200">{feedback}</p>
    <div className="mt-auto flex flex-col pt-3">{children}</div>
  </section>
}

export function DashboardAssessment({ model }: { model: DashboardAssessmentModel }) {
  const { website, websiteReport, social, socialView, socialReport, latestWebsiteAttempt, top, main, websiteResults, consistency, socialScore, scoreAssessment } = model
  const asScore = (score: typeof main.overall): Score | null => score.value === null ? null : { ...score, value: score.value }
  const policyLabel = `SEO Spy policy ${scoreAssessment?.policyVersion.replace('seo-spy-score-', '') ?? 'v1'}`
  const websiteSource = [websiteReport ? `Saved website report · ${websiteReport.audit.completedAt ?? websiteReport.generatedAt} · Homepage coverage` : 'No saved website report is available.',
    websiteResults.overall.value === null ? 'SEO Spy score not available' : `${policyLabel} · ${scoreAssessment?.profile === 'baseline-desktop-v1' ? 'Desktop' : 'Mobile'} · ${scoreAssessment?.cutoff}`, websiteReport?.audit.status === 'partial' ? 'Partial coverage' : '',
    latestWebsiteAttempt?.status === 'failed' ? 'A newer report attempt failed. Previous saved results remain visible.' : '', website.error ?? ''].filter(Boolean).join(' · ')
  const socialSource = [socialView ? `Saved Facebook report · ${socialView.facebook.pageName} · ${socialReport?.results.facebook.collectedAt}` : 'Numeric social score not available',
    socialView ? socialScore.value === null ? 'Numeric score not available' : `${policyLabel} · ${scoreAssessment?.cutoff}` : '', socialReport?.audit.status === 'partial' ? 'Partial coverage' : '',
    social.data?.latestAttempt?.status === 'failed' ? 'A newer report attempt failed. Previous saved results remain visible.' : '', social.error ?? ''].filter(Boolean).join(' · ')
  return <section aria-labelledby="spy-total-title" className="min-w-0 rounded-2xl border border-blue-500/60 bg-surface p-3 shadow-lg shadow-blue-950/20 sm:p-5">
    <div className="flex items-center gap-3"><SpyLogo /><div><p className="text-xs font-semibold text-blue-300">SEO Spy</p><h2 id="spy-total-title" className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">Spy Total Score</h2></div></div>
    <div className="mt-5 grid min-w-0 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-[1.08fr_1fr_1fr_1fr]">
      <section aria-label="Overall assessment" className="flex min-w-0 flex-col rounded-xl border border-blue-400/20 bg-blue-500/[0.03] p-4 md:col-span-2 xl:col-span-1">
        <ScoreCard score={main.overall} live prominent />
        <p className="mt-4 text-xs leading-5 text-secondary">SEO Spy combines your website health, social media performance, and business consistency to give you one overall view of your online presence.</p>
        {main.overall.value === null && <p className="mt-2 text-[10px] leading-4 text-muted">Combined SEO Spy score not available while required evidence is missing.</p>}
        <dl className="mt-auto space-y-3 border-t border-line pt-4 text-[11px]">
          {[
            { label: 'Website Health', score: asScore(websiteResults.overall), dot: 'bg-cyan-400' },
            { label: 'Social Media Performance', score: asScore(socialScore), dot: 'bg-blue-500' },
            { label: 'Business Consistency', score: asScore(consistency.score), dot: 'bg-amber-400' },
          ].map(item => <div key={item.label} className="flex items-start justify-between gap-2"><dt className="flex min-w-0 items-start gap-2 text-secondary"><span className={`mt-1 size-1.5 shrink-0 rounded-full ${item.dot}`} aria-hidden="true" />{item.label}</dt><dd className="shrink-0 text-right font-semibold text-ink">{item.score ? `${item.score.value}/${item.score.maximum}` : <><span aria-hidden="true">—</span><span className="block text-[10px] font-normal text-muted">Not available</span></>}</dd></div>)}
        </dl>
      </section>
      <Category accent="border-cyan-400/30 bg-cyan-400/15 text-cyan-300" title="Website Health" description="How your website performs for search engines and visitors." icon={<Monitor size={25} aria-hidden="true" />} score={asScore(websiteResults.overall)} source={websiteSource} issuesContent={<RecommendedWordPressFixes key={model.businessId} businessId={model.businessId} />} issues={[]} empty="">
        <Link to={`/website?businessId=${encodeURIComponent(model.businessId)}`} className={reportStyle}>Open Website Report</Link>
      </Category>
      <Category accent="border-blue-400/40 bg-blue-600 text-white" title="Social Media Performance" description="How your social presence and activity support your business." icon={<FacebookMark />} score={asScore(socialScore)} source={socialSource} issues={top.social} empty={social.loading ? 'Loading your saved Facebook report…' : social.error ? social.error : socialView ? 'No issues were found in the saved checks. Coverage may be limited; review the full report.' : 'No saved Facebook report is available. Connect a Page and generate a report to see its findings.'}>
        {social.error && <button type="button" onClick={social.refresh} className={`${reportStyle} mb-3`}>Retry saved report</button>}
        <Link to={`/social-media?businessId=${encodeURIComponent(model.businessId)}`} className={reportStyle}>Open Social Media Report</Link>
      </Category>
      <Category accent="border-amber-400/30 bg-amber-400/15 text-amber-300" title="Business Consistency" description="How consistent your business information is across connected platforms." icon={<Store size={25} aria-hidden="true" />} score={asScore(consistency.score)} source={consistency.checks.some(check => check.matches !== null) ? `Saved comparison · ${scoreAssessment?.cutoff}` : 'No saved business comparison is available.'} issues={top.consistency} empty={consistency.checks.some(check => check.matches !== null) ? 'Review the saved comparison details. Coverage may be limited.' : 'No saved business comparison is available.'}>
        <details id="consistency-details" tabIndex={-1} className="mt-auto rounded-lg border border-blue-400/40 text-xs text-blue-200"><summary className="min-h-[42px] cursor-pointer rounded-lg px-2 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-blue-300">View Consistency Details</summary><ul className="space-y-4 border-t border-line p-3">{consistency.checks.map(check => <li key={check.id} className="break-words text-xs leading-5"><p className="font-semibold text-ink">{check.label} · {check.matches === null ? 'Not available' : check.matches ? 'Matches' : 'Needs review'}</p><p>Website: {check.website}</p><p>Facebook: {check.social}</p></li>)}</ul></details>
      </Category>
    </div>
  </section>
}
