import type { Finding, WebsiteResults } from './dashboard'

export type IssuePriority = 'Critical' | 'Medium' | 'Low'
export type WebsiteCategory = 'Metadata' | 'Content' | 'Technical SEO' | 'Accessibility' | 'Performance'

export interface ConnectedWebsite {
  id: string
  domain: string
  url: string
  status: 'Connected'
}

export interface WebsiteFinding extends Finding {
  severity: IssuePriority
  source: 'Website'
  category: WebsiteCategory
  evidence: string
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
