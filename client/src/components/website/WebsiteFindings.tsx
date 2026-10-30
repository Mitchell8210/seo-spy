import { useRef } from 'react'
import { ArrowDown, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { AffectedPage, PassedCheck, WebsiteFinding, WebsiteRecommendation } from '../../types/website'
import type { Severity } from '../../types/dashboard'
import { findingStatuses } from '../../utils/findingStatus'
import { ReportDisclosure } from '../reports/ReportDisclosure'
import { FindingActions } from '../reports/FindingActions'
import { PriorityColumn } from '../reports/PriorityColumn'
import { StatusBadge } from '../common/StatusBadge'

type BoardItem =
  | { kind: 'issue'; finding: WebsiteFinding; pages: AffectedPage[]; recommendations: WebsiteRecommendation[] }
  | { kind: 'check'; check: PassedCheck }

const columns = [
  { id: 'urgent', label: 'Urgent', description: 'Issues to address first.', severity: 'Critical', icon: TriangleAlert, accepts: ['Critical'] },
  { id: 'medium', label: 'Medium', description: 'Improvements to plan next.', severity: 'Medium', icon: CircleAlert, accepts: ['Medium'] },
  { id: 'low', label: 'Low', description: 'Smaller opportunities to refine.', severity: 'Low', icon: ArrowDown, accepts: ['Low'] },
  { id: 'great', label: 'Great Condition', description: 'Healthy checks with supporting evidence.', severity: 'Passed', icon: CircleCheck, accepts: ['Passed', 'Verified'] },
] satisfies { id: string; label: string; description: string; severity: Severity; icon: typeof CircleAlert; accepts: Severity[] }[]

function BoardCard({ item, live, evidenceLabel }: { item: BoardItem; live: boolean; evidenceLabel: string }) {
  const fixRef = useRef<HTMLHeadingElement>(null)
  const isIssue = item.kind === 'issue'
  const title = isIssue ? item.finding.title : item.check.title
  const severity = isIssue ? item.finding.severity : item.check.status
  const urls = isIssue ? item.pages.map((page) => page.url) : [item.check.url]

  return (
    <li id={isIssue ? item.finding.id : `board-${item.check.id}`} className="min-w-0 scroll-mt-6 rounded-lg border border-line bg-surface p-4 shadow-sm [overflow-wrap:anywhere]">
      <StatusBadge label={severity} tone={findingStatuses[severity].tone} />
      <h4 className="mt-3 break-words text-sm font-semibold leading-6 text-ink">{title}</h4>
      {isIssue && <>
        <p className="mt-2 text-xs font-medium text-secondary">{item.finding.category}</p>
        {urls.length > 0 && <p className="mt-2 break-all text-xs leading-5 text-muted"><span className="font-medium text-secondary">Page: </span>{urls[0]}{urls.length > 1 && <span className="block">+ {urls.length - 1} more affected {urls.length === 2 ? 'page' : 'pages'}</span>}</p>}
      </>}
      <ReportDisclosure title={title} isIssue={isIssue}>
        <div><h5 className="font-semibold text-ink">{isIssue ? 'What we found' : 'What was checked'}</h5><p className="mt-1">{title}</p></div>
        <div><h5 className="font-semibold text-ink">Evidence</h5><p className="mt-1">{isIssue ? item.finding.evidence : item.check.evidence}</p><p className="mt-1 text-muted">{live ? (isIssue ? item.finding.evidenceLabel : item.check.evidenceLabel) ?? evidenceLabel : 'Mock evidence · Not a live scan'}</p></div>
        {isIssue && <div><h5 className="font-semibold text-ink">Why it matters</h5><p className="mt-1">{item.finding.explanation}</p></div>}
        <div>
          <h5 className="font-semibold text-ink">{isIssue ? 'Affected page(s)' : 'Relevant URL'}</h5>
          <ul className="mt-1 space-y-2">{urls.map((url) => <li key={url} className="break-all text-blue-300">{url}</li>)}</ul>
        </div>
        {isIssue ? <>
          <div>
            <h5 ref={fixRef} tabIndex={-1} className="scroll-mt-6 rounded-sm font-semibold text-ink">Recommended fix</h5>
            {item.recommendations.length > 0 ? <ul className="mt-1 space-y-3">{item.recommendations.map((recommendation) => <li key={recommendation.id} data-recommendation-id={recommendation.id}>{recommendation.action}</li>)}</ul> : <p className="mt-1 text-muted">No recommended fix is linked to this finding yet.</p>}
            <p className="mt-2 text-muted">Priority: {item.finding.severity} · Suggested change · Not applied</p>
          </div>
          <FindingActions live={live} fixRef={fixRef} hasRecommendation={item.recommendations.length > 0} />
        </> : <div><h5 className="font-semibold text-ink">Verification result</h5><p className="mt-1">{live ? 'Passed in this Lighthouse run. Remediation has not been verified.' : `${item.check.status} in this mock analysis. No live verification was performed.`}</p></div>}
        <dl className="space-y-1 border-t border-line pt-3 text-muted">
          <div><dt className="inline font-medium text-secondary">Source: </dt><dd className="inline">{isIssue ? item.finding.source : 'Website'}</dd></div>
          <div><dt className="inline font-medium text-secondary">Status: </dt><dd className="inline">{isIssue ? item.finding.status : item.check.status}</dd></div>
        </dl>
      </ReportDisclosure>
    </li>
  )
}

type WebsiteFindingsProps = {
  findings: WebsiteFinding[]
  pages: AffectedPage[]
  passedChecks: PassedCheck[]
  passedTotal: number | null
  live?: boolean
  evidenceLabel?: string
  recommendations: WebsiteRecommendation[]
}

export function WebsiteFindings({ findings, pages, passedChecks, recommendations, live = false, evidenceLabel = '' }: WebsiteFindingsProps) {
  const items: BoardItem[] = [
    ...findings.map((finding): BoardItem => ({
      kind: 'issue',
      finding,
      pages: pages.filter((page) => page.id === finding.pageId || page.findingIds.includes(finding.id)),
      recommendations: recommendations.filter((recommendation) => recommendation.findingId === finding.id),
    })),
    ...passedChecks.map((check): BoardItem => ({ kind: 'check', check })),
  ]
  const unmapped = recommendations.filter((recommendation) => !findings.some((finding) => finding.id === recommendation.findingId))

  return (
    <section aria-labelledby="website-findings-title" className="min-w-0 rounded-xl border border-line bg-surface shadow-sm">
      <div className="border-b border-line p-5 sm:px-6">
        <h2 id="website-findings-title" className="text-lg font-semibold text-ink">SEO Spy Website Report</h2>
        <p className="mt-1 text-xs leading-6 text-muted">Your website issues, verified checks, and recommended fixes organized by priority.</p>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 p-4 md:grid-cols-2 xl:grid-cols-4 sm:p-5">
        {columns.map((column) => {
          const grouped = items.filter((item) => column.accepts.some((severity) => severity === (item.kind === 'issue' ? item.finding.severity : item.check.status)))
          return (
            <PriorityColumn key={column.id} headingId={`findings-${column.id}-title`} label={column.label} description={column.description} severity={column.severity} count={grouped.length}>
              {grouped.map((item) => <BoardCard key={item.kind === 'issue' ? item.finding.id : item.check.id} item={item} live={live} evidenceLabel={evidenceLabel} />)}
            </PriorityColumn>
          )
        })}
      </div>
      {unmapped.length > 0 && <div className="border-t border-line p-5 text-sm text-secondary"><h3 className="font-semibold text-ink">Recommendations awaiting a finding match</h3><p className="mt-1">These suggestions have not been attached to a finding.</p><ul className="mt-3 space-y-2">{unmapped.map((recommendation) => <li key={recommendation.id}>{recommendation.action}</li>)}</ul></div>}
    </section>
  )
}
