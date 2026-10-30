import type { AuditFailure, AuditStatus, Business, Evidence, Finding, Recommendation, ReportFileReference, Score } from './backend'
import type { EvidenceSummaries } from './websiteApi'

export type FacebookFinding = Omit<Finding, 'source'> & { source: 'facebook' | Finding['source'] }
export interface FacebookField {
  status: 'available' | 'missing' | 'unavailable'
  value: string | number | boolean | Record<string, string | number> | string[] | null
  collectedAt: string
  failureCode?: string
}
export interface FacebookMetric {
  name: string
  status: 'available' | 'missing' | 'unavailable'
  period: 'day'
  points: { endTime: string; value: number }[]
  aggregation: 'sum' | 'snapshot'
  total: number | null
  collectedAt: string
}
export interface FacebookReport {
  provider: 'facebook-graph'
  version: 'facebook-v1'
  graphVersion: string
  pageId: string
  pageName: string
  collectedAt: string
  window: { since: string; until: string; requestedDays: number }
  profile: Record<string, FacebookField>
  posts: { status: 'available' | 'missing' | 'unavailable'; items: { id: string; message: string | null; createdTime: string | null; url: string }[]; truncated: boolean; collectedAt: string }
  metrics: FacebookMetric[]
  summary: { followersStart: number | null; followersEnd: number | null; followersChange: number | null; latestPostAt: string | null; postsInWindow: number | null; postsInWindowComplete: boolean }
  coverage: { profileFieldsAvailable: number; profileFieldsMissing: number; profileFieldsUnavailable: number; metricsAvailable: number; metricsRequested: number; postsLimit: number }
  limitations: string[]
}
export interface FacebookAnalysis {
  evidenceSummaries?: EvidenceSummaries
  version: 'facebook-analysis-v1'
  auditId: string
  summaries: string[]
  findings: FacebookFinding[]
  recommendations: Recommendation[]
}
export interface FacebookReportRecord {
  schemaVersion: 'seo-spy.audit-report.v1'
  reportId: string
  auditId: string
  generatedAt: string
  business: Business
  audit: { id: string; businessId: string; scope: 'facebook'; mode: 'live'; status: AuditStatus; warnings: string[]; failure: AuditFailure | null }
  results: { facebook: FacebookReport; findings: FacebookFinding[]; recommendations: Recommendation[]; evidence: Evidence[]; scores: Score[] }
}
export interface FacebookReportResponse {
  businessId: string
  report: FacebookReportRecord | null
  analysis: FacebookAnalysis | null
  latestAttempt: (ReportFileReference & { businessId: string; status: AuditStatus; scope: 'facebook'; mode: 'live'; counts: { findings: number; recommendations: number } }) | null
}

export interface CreatedFacebookReport extends ReportFileReference {
  status: 'completed' | 'partial' | 'failed'
  failure: AuditFailure | null
}
