import type { AuditSummaryDto, DashboardDto, FindingsResponseDto, RecommendationsResponseDto } from '../contracts/responses.dto.js';

export function buildHomepageReport(
  audit: AuditSummaryDto,
  findings: FindingsResponseDto,
  recommendations: RecommendationsResponseDto,
  dashboard: DashboardDto,
) {
  return {
    testedAt: new Date().toISOString(), audit, ...findings,
    recommendations: recommendations.recommendations,
    // On failure the dashboard deliberately retains a previous completed audit.
    scores: dashboard.latestAudit?.id === audit.id ? dashboard.scores : [],
  };
}
