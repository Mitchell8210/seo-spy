export type Severity = 'Critical' | 'Medium' | 'Low' | 'Passed' | 'Verified'
export type FindingSource = 'Website' | 'Website + Facebook'

export interface Business {
  id: string
  name: string
  website: string
  status: 'Ready for analysis'
}

export interface Connection {
  id: string
  name: string
  platform: 'website' | 'facebook'
  identity: string
  status: 'Connected'
}

export interface Score {
  id: string
  label: string
  value: number
  maximum: number
  description: string
}

export interface Finding {
  id: string
  severity: Severity
  source: FindingSource
  title: string
  explanation: string
  status: 'Needs review'
}

export interface Recommendation {
  id: string
  findingId: string
  title: string
  explanation: string
  severity: Severity
  source: FindingSource
  status: 'Needs review'
}

export interface WebsiteResults {
  categories: Score[]
  overall: Score
  issues: number
  checksPassed: number
}

export interface SocialMetric {
  id: 'followers' | 'reach' | 'engagement' | 'interactions'
  label: string
  value: string
}

export interface SocialResults {
  account: string
  metrics: SocialMetric[]
  secondary: { label: string; value: string }[]
}

export interface ConsistencyResults {
  score: Score
  channels: string
  checks: { id: string; label: string; matches: boolean; website: string; social: string }[]
}

export interface MainSpyResults {
  overall: Score
  components: Score[]
  priorityOpportunities: number
}
