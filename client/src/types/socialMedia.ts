import type { Score } from './dashboard'

export type SocialPriority = 'Critical' | 'Medium' | 'Low'
export type SocialCategory = 'Profile' | 'Content' | 'Engagement' | 'Visibility' | 'Business Information' | 'Growth'

export interface SocialAccount {
  id: string
  businessId: string
  platform: 'Facebook' | 'Instagram'
  name: string
  status: 'Connected'
}

export interface SocialHealthMetric {
  id: 'followers' | 'reach' | 'contacts' | 'interactions'
  title: string
  value: string
  supporting: { id: string; label: string; value: string; direction?: 'up' | 'down' | 'neutral' }[]
}

export interface SocialFinding {
  id: string
  title: string
  category: SocialCategory
  severity: SocialPriority
  status: 'Needs review'
  explanation: string
  evidence: string
  impact: string
  affectedArea: string
  recommendation: { id: string; action: string }
}

export interface SocialPassedCheck {
  id: string
  title: string
  status: 'Passed' | 'Verified'
  checked: string
  evidence: string
  whyHealthy: string
}

export interface SocialMediaAudit {
  id: string
  accountId: string
  analyzedAt: string
  periodLabel: string
  score: Score
  scoreSummary: string
  healthMetrics: SocialHealthMetric[]
  findings: SocialFinding[]
  passedChecks: SocialPassedCheck[]
}
