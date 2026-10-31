import type { Connection, ConsistencyResults, Finding, MainSpyResults, Recommendation } from './dashboard'
import type { MeasuredWebsiteResults, WebsiteScore } from './website'

export type DashboardWebsiteResults = Omit<MeasuredWebsiteResults, 'issues'> & { issues: number | null }

export type DashboardFinding = Omit<Finding, 'source'> & { source: Finding['source'] | 'Facebook' }
export type DashboardRecommendation = Omit<Recommendation, 'source'> & { source: DashboardFinding['source'] }
export type DashboardConnection = Connection
export type DashboardMainScore = Omit<MainSpyResults, 'overall' | 'components' | 'priorityOpportunities'> & {
  overall: WebsiteScore
  components: WebsiteScore[]
  priorityOpportunities: number | null
}
export type DashboardConsistency = Omit<ConsistencyResults, 'score' | 'checks'> & {
  score: WebsiteScore
  checks: (Omit<ConsistencyResults['checks'][number], 'matches'> & { matches: boolean | null })[]
}
