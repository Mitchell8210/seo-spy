import type { Finding, Score, WebsiteResults } from './dashboard'

export type WebsiteScore = Omit<Score, 'value'> & { value: number | null }
export interface MeasuredWebsiteResults extends Omit<WebsiteResults, 'overall' | 'categories' | 'checksPassed'> {
  overall: WebsiteScore
  categories: WebsiteScore[]
  checksPassed: number | null
}
export type LiveWebsiteAudit = Omit<WebsiteAudit, 'results'> & { results: MeasuredWebsiteResults }

export type IssuePriority = 'Critical' | 'Medium' | 'Low'
export type WebsiteCategory = 'Metadata' | 'Content' | 'Technical SEO' | 'Accessibility' | 'Performance'

export interface ConnectedWebsite {
  id: string
  domain: string
  url: string
  status: 'Connected' | 'Not connected' | 'Needs attention' | 'Checking' | 'Error' | 'Saved report' | 'Not available'
}

export interface WebsiteFinding extends Finding {
  severity: IssuePriority
  source: 'Website'
  category: string
  evidence: string
  evidenceLabel?: string
  pageId: string
}

export interface AffectedPage {
  id: string
  url: string
  findingIds: string[]
}

export interface PassedCheck {
  id: string
  title: string
  evidence: string
  evidenceLabel?: string
  status: 'Passed' | 'Verified'
  url: string
}

export interface WebsiteRecommendation {
  id: string
  findingId: string
  action: string
}

export interface WebsiteAudit {
  id: string
  websiteId: string
  analyzedAt: string
  results: WebsiteResults
  findings: WebsiteFinding[]
  pages: AffectedPage[]
  passedChecks: PassedCheck[]
  recommendations: WebsiteRecommendation[]
}
