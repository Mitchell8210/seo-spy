import { useRef } from 'react'
import { BadgeCheck } from 'lucide-react'
import type { SocialFinding, SocialPassedCheck, SocialPriority } from '../../types/socialMedia'
import { findingStatuses } from '../../utils/findingStatus'
import { StatusBadge } from '../common/StatusBadge'
import { FindingActions } from '../reports/FindingActions'
import { ReportDisclosure } from '../reports/ReportDisclosure'
import { PriorityColumn } from '../reports/PriorityColumn'

const columns = [
  { id: 'urgent', label: 'Urgent', description: 'Items that need your attention.', severity: 'Critical' },
  { id: 'medium', label: 'Medium', description: 'Important things to improve.', severity: 'Medium' },
  { id: 'low', label: 'Low', description: 'Small improvements that can help.', severity: 'Low' },
] satisfies { id: string; label: string; description: string; severity: SocialPriority }[]

type SocialCardProps = ({ kind: 'issue'; finding: SocialFinding } | { kind: 'check'; check: SocialPassedCheck }) & { mode?: 'demo' | 'live'; evidenceLabel?: string }

function SocialReportCard(props: SocialCardProps) {
  const fixRef = useRef<HTMLHeadingElement>(null)
  const issue = props.kind === 'issue'
  const live = props.mode === 'live'
  const item = issue ? props.finding : props.check
  const severity = issue ? props.finding.severity : props.check.status
  return (
    <li id={item.id} className={`min-w-0 scroll-mt-6 rounded-xl border bg-surface p-4 shadow-md shadow-black/10 ${issue ? 'border-line' : 'border-blue-400/25'}`}>
      <div className="flex items-center justify-between gap-2"><StatusBadge label={severity} tone={findingStatuses[severity].tone} />{!issue && <BadgeCheck size={20} className="text-blue-400" aria-hidden="true" />}</div>
      <h4 className="mt-4 break-words text-sm font-semibold leading-6 text-ink">{item.title}</h4>
      {issue && <><p className="mt-2 text-xs font-medium text-secondary">{props.finding.category}</p><p className="mt-2 text-xs leading-5 text-muted">{props.finding.affectedArea}</p></>}
      <ReportDisclosure title={item.title} isIssue={issue} emphasized>
        <div><h5 className="font-semibold text-ink">{issue ? 'What we found' : 'What was checked'}</h5><p className="mt-1">{issue ? props.finding.explanation : props.check.checked}</p></div>
        <div><h5 className="font-semibold text-ink">Evidence</h5><p className="mt-1 whitespace-pre-wrap break-words">{item.evidence}</p><p className="mt-1 text-muted">{live ? props.evidenceLabel ?? 'Saved Facebook evidence from the report collection.' : 'Mock evidence · Not a live Facebook check'}</p></div>
        <div><h5 className="font-semibold text-ink">{issue ? 'Why it matters' : 'Why it is healthy'}</h5><p className="mt-1">{issue ? props.finding.impact : props.check.whyHealthy}</p></div>
        {issue ? <>
          <div><h5 className="font-semibold text-ink">Affected area</h5><p className="mt-1">{props.finding.affectedArea}</p></div>
          <div><h5 ref={fixRef} tabIndex={-1} className="scroll-mt-6 rounded-sm font-semibold text-ink">Recommended fix</h5><p className="mt-1" data-recommendation-id={props.finding.recommendation.id}>{props.finding.recommendation.action}</p><p className="mt-2 text-muted">Suggested change · Not applied</p></div>
          <FindingActions fixRef={fixRef} hasRecommendation target="account" live={live} />
          <p className="border-t border-line pt-3 text-muted">Status: {props.finding.status}</p>
        </> : <div><h5 className="font-semibold text-ink">Verification result</h5><p className="mt-1">{live ? `${props.check.status} against the saved evidence. Current Page state may differ.` : `${props.check.status} in this mock analysis. No live verification was performed.`}</p></div>}
      </ReportDisclosure>
    </li>
  )
}

export function SocialMediaReport({ findings, checks, mode = 'demo', evidenceLabel }: { findings: SocialFinding[]; checks: SocialPassedCheck[]; mode?: 'demo' | 'live'; evidenceLabel?: string }) {
  return (
    <section aria-labelledby="social-report-title" className="min-w-0 rounded-2xl border border-line bg-surface shadow-xl shadow-black/10">
      <div className="border-b border-line p-5 sm:p-7"><h2 id="social-report-title" className="text-xl font-semibold tracking-tight text-ink">SEO Spy Social Media Report</h2><p className="mt-1 text-xs leading-6 text-muted">Your social media issues, verified checks, and recommended fixes organized by priority.</p></div>
      <div className="grid grid-cols-1 items-start gap-4 p-4 md:grid-cols-2 xl:grid-cols-4 sm:p-6">
        {columns.map((column) => {
          const grouped = findings.filter((finding) => finding.severity === column.severity)
          return <PriorityColumn emphasized key={column.id} headingId={`social-${column.id}-title`} label={column.label} description={column.description} severity={column.severity} count={grouped.length}>{grouped.map((finding) => <SocialReportCard key={finding.id} kind="issue" finding={finding} mode={mode} evidenceLabel={evidenceLabel} />)}</PriorityColumn>
        })}
        <PriorityColumn emphasized headingId="social-great-title" label="Great Condition" description="Things that are working well." severity="Passed" count={checks.length}>{checks.map((check) => <SocialReportCard key={check.id} kind="check" check={check} mode={mode} evidenceLabel={evidenceLabel} />)}</PriorityColumn>
      </div>
    </section>
  )
}
