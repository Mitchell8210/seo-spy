import type { AuditSummary, Business, DataMode, Evidence, Finding, LighthouseReport, Recommendation, ReportFileReference } from './backend'

export interface EvidenceSummaryItem { id: string; evidenceIds: string[]; text: string; sourceLabel: string }
export interface EvidenceSummaries {
  version: 'programmatic-evidence-v1'
  auditId: string
  findings: EvidenceSummaryItem[]
  checks: EvidenceSummaryItem[]
}
export interface WebsiteAnalysis {
  version: 'website-priority-v1'
  auditId: string
  findings: Finding[]
  recommendations: Recommendation[]
  priorities: { findingId: string; ruleId: string; severity: Finding['severity']; reason: string; evidenceIds: string[] }[]
}

export interface WebsiteReportSummary extends ReportFileReference {
  businessId: string
  scope: string
  mode: DataMode
  status: AuditSummary['status']
  counts: AuditSummary['counts']
}

export interface WebsiteReport {
  schemaVersion: 'seo-spy.audit-report.v1'
  reportId: string
  auditId: string
  generatedAt: string
  business: Business
  audit: AuditSummary
  results: {
    websiteAnalysis?: WebsiteAnalysis
    evidenceSummaries?: EvidenceSummaries
    findings: Finding[]
    evidence: Evidence[]
    recommendations: Recommendation[]
    lighthouse?: LighthouseReport
  } | null
}

export interface WebsiteReportList { businessId: string; reports: WebsiteReportSummary[] }
