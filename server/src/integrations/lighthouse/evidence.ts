import { randomUUID } from "node:crypto";
import type {
  AuditResults,
  Evidence,
  Finding,
} from "../../contracts/domain.js";
import type { LighthouseReport } from "./types.js";

export function attachLighthouse(
  results: AuditResults,
  report: LighthouseReport,
  auditId: string,
) {
  results.lighthouse = report;
  const summary: Evidence = {
    id: randomUUID(),
    auditId,
    checkId: "lighthouse:report",
    sourceUrl: report.finalUrl,
    collectedAt: report.fetchedAt,
    mode: "live",
    observed: {
      provider: report.provider,
      strategy: report.strategy,
      lighthouseVersion: report.lighthouseVersion,
      requestedUrl: report.requestedUrl,
      categories: JSON.stringify(report.categories),
      metrics: JSON.stringify(report.metrics),
      warnings: JSON.stringify(report.warnings),
    },
  };
  results.evidence.push(summary);
  const referenced = new Set(
    report.categories.flatMap((category) => category.auditIds),
  );
  for (const check of report.checks) {
    if (
      !referenced.has(check.id) ||
      !["binary", "numeric"].includes(check.scoreDisplayMode) ||
      check.score === null ||
      check.score >= 1
    )
      continue;
    const checkId = `lighthouse:${check.id}`;
    const evidence: Evidence = {
      id: randomUUID(),
      auditId,
      checkId,
      sourceUrl: report.finalUrl,
      collectedAt: report.fetchedAt,
      mode: "live",
      observed: {
        title: check.title,
        description: check.description,
        score: String(check.score),
        scoreDisplayMode: check.scoreDisplayMode,
        displayValue: check.displayValue ?? "",
        explanation: check.explanation ?? "",
      },
    };
    const finding: Finding = {
      id: randomUUID(),
      auditId,
      checkId,
      evidenceIds: [evidence.id, summary.id],
      severity: "low",
      source: "website",
      title: `Lighthouse: ${check.title}`,
      explanation: check.description,
      status: "needs_review",
    };
    results.evidence.push(evidence);
    results.findings.push(finding);
    results.recommendations.push({
      id: randomUUID(),
      auditId,
      findingId: finding.id,
      title: finding.title,
      explanation: check.description,
      recommendedChange: `Review the Lighthouse guidance for "${check.title}" and verify the applicable change against the page evidence.`,
      purpose:
        "Address a measured Lighthouse lab audit; confirm applicability before making changes.",
      status: "needs_review",
    });
  }
}
