import type {
  AuditSummaryDto,
  DashboardDto,
  FindingsResponseDto,
  RecommendationsResponseDto,
} from "../contracts/responses.dto.js";
import type { LighthouseResponseDto } from "../contracts/lighthouse.dto.js";

export function buildHomepageReport(
  audit: AuditSummaryDto,
  findings: FindingsResponseDto,
  recommendations: RecommendationsResponseDto,
  dashboard: DashboardDto,
  lighthouse?: LighthouseResponseDto,
) {
  return {
    testedAt: new Date().toISOString(),
    audit,
    ...findings,
    recommendations: recommendations.recommendations,
    // On failure the dashboard deliberately retains a previous completed audit.
    scores: dashboard.latestAudit?.id === audit.id ? dashboard.scores : [],
    ...(lighthouse?.auditId === audit.id
      ? { lighthouse: lighthouse.report }
      : {}),
  };
}
