// Public API types owned by the isolated backend lab. No backend implementation imports.
export type AuditStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed'
export type AuditStage = 'queued' | 'collecting_evidence' | 'evaluating_checks' | 'running_lighthouse' | 'preparing_recommendations' | 'complete' | 'failed'
export type AuditScope = 'demo' | 'homepage' | 'lighthouse'
export type LighthouseStrategy = 'mobile' | 'desktop'
export type Strategy = LighthouseStrategy
export type DataMode = 'demo' | 'live'

export interface AuditFailure { code: string; message: string }

export interface AuditSummary {
  id: string
  businessId: string
  scope: AuditScope
  strategy?: Strategy
  mode: DataMode
  status: AuditStatus
  stage: AuditStage
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  warnings: string[]
  failure: AuditFailure | null
  scoringVersion: 'demo-v1' | 'homepage-v1' | 'lighthouse-v1'
  counts: { findings: number; recommendations: number }
}

export interface CreatedAudit extends AuditSummary { statusUrl: string }

export interface Business { id: string; name: string; website: string; createdAt: string }
export interface Connection {
  id: string
  businessId: string
  platform: 'website' | 'facebook'
  identity: string
  status: 'connected' | 'disconnected' | 'authorization_required' | 'checking' | 'error'
  mode: DataMode
}
export interface Score {
  category: 'website' | 'social' | 'consistency' | 'overall'
  value: number | null
  maximum: number
  availability: 'demo' | 'unavailable'
  scoringVersion: 'demo-v1' | 'homepage-v1'
}
export interface Evidence {
  id: string
  auditId: string
  checkId: string
  sourceUrl: string
  collectedAt: string
  observed: Record<string, string>
  mode: DataMode
}
export interface Finding {
  id: string
  auditId: string
  checkId: string
  evidenceIds: string[]
  severity: 'critical' | 'medium' | 'low'
  source: 'website' | 'website_and_facebook'
  title: string
  explanation: string
  status: 'needs_review'
}
export interface Recommendation {
  id: string
  auditId: string
  findingId: string
  title: string
  explanation: string
  recommendedChange: string
  purpose: string
  status: 'needs_review'
}
export interface LighthouseCategory {
  id: 'performance' | 'accessibility' | 'best-practices' | 'seo'
  title: string
  score: number | null
  availability: 'measured' | 'unavailable'
  auditIds: string[]
}
export interface LighthouseMetric {
  id: string
  title: string
  value: number | null
  unit: 'ms' | 'unitless'
  displayValue: string | null
}
export interface LighthouseCheck {
  id: string
  title: string
  description: string
  score: number | null
  scoreDisplayMode: string
  displayValue: string | null
  explanation: string | null
}
export interface LighthouseReport {
  provider: 'google-pagespeed-insights'
  strategy: Strategy
  requestedUrl: string
  finalUrl: string
  fetchedAt: string
  lighthouseVersion: string
  categories: LighthouseCategory[]
  metrics: LighthouseMetric[]
  checks: LighthouseCheck[]
  warnings: string[]
}
export interface Dashboard {
  mode: DataMode
  notice: string
  business: Business
  connections: Connection[]
  latestAudit: AuditSummary | null
  activeAudit: AuditSummary | null
  scores: Score[]
  lighthouse: LighthouseReport | null
  findings: Finding[]
  recommendations: Recommendation[]
  priorityOpportunities: number
}
export interface FindingsResponse {
  mode: DataMode
  auditId: string
  status: AuditStatus
  findings: Finding[]
  evidence: Evidence[]
}
export interface RecommendationsResponse {
  mode: DataMode
  auditId: string
  status: AuditStatus
  recommendations: Recommendation[]
}
export interface LighthouseResponse {
  mode: DataMode
  auditId: string
  status: AuditStatus
  report: LighthouseReport | null
  failure: AuditFailure | null
  warnings: string[]
}

export interface LabError {
  message: string
  code?: string
  requestId?: string
}
