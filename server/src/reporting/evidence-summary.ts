import type { AuditResults, Evidence } from "../contracts/domain.js";

export interface EvidenceSummaryItem {
  id: string;
  evidenceIds: string[];
  text: string;
  sourceLabel: string;
}

export interface EvidenceSummaries {
  version: "programmatic-evidence-v1";
  auditId: string;
  findings: EvidenceSummaryItem[];
  checks: EvidenceSummaryItem[];
}

// Presentation text is derived from backend analysis/provider observations, never
// a catalog of finding-specific copy. Original observations remain unchanged.
function concise(value: string, limit = 280): string {
  const plain = value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+|data:[^\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= limit) return plain;
  const excerpt = plain.slice(0, limit - 1);
  const sentence = excerpt.match(/^[\s\S]*[.!?](?=\s|$)/)?.[0];
  return sentence || `${excerpt.slice(0, excerpt.lastIndexOf(" ") > 0 ? excerpt.lastIndexOf(" ") : excerpt.length)}…`;
}

function sourceLabel(evidence: Pick<Evidence, "checkId" | "collectedAt">[], results: AuditResults): string {
  if (!evidence.length) return "Not available";
  const lighthouse = evidence.some((item) => item.checkId.startsWith("lighthouse:"));
  const source = lighthouse ? `Lighthouse · ${results.lighthouse?.strategy ?? "lab"}` : "Homepage HTML";
  const timestamp = evidence[0]?.collectedAt;
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return source;
  return `${source} · ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(timestamp))} UTC`;
}

export function summarizeEvidence(auditId: string, results: AuditResults | null): EvidenceSummaries {
  const summary: EvidenceSummaries = { version: "programmatic-evidence-v1", auditId, findings: [], checks: [] };
  if (!results) return summary;
  summary.findings = results.findings.map((finding) => {
    const linked = results.evidence.filter((item) => item.auditId === auditId && finding.evidenceIds.includes(item.id));
    // The shared Lighthouse report is provenance, not this finding's result.
    const specific = linked.filter((item) => item.checkId === finding.checkId);
    const observed = specific[0]?.observed;
    let text = "Supporting evidence is unavailable for this finding.";
    if (specific.length) {
      if (finding.checkId.startsWith("lighthouse:")) {
        const title = concise(observed?.title || finding.title.replace(/^Lighthouse:\s*/, ""), 160);
        const value = concise(observed?.displayValue ?? "", 80);
        const explanation = concise(observed?.explanation ?? "", 160);
        text = concise([value ? `${title}: ${value}.` : `Lighthouse reported: ${title.replace(/[.!?]$/, "")}.`, explanation].filter(Boolean).join(" "));
      } else {
        text = concise(finding.explanation || finding.title);
      }
    }
    return { id: finding.id, evidenceIds: linked.map((item) => item.id), text, sourceLabel: sourceLabel(specific, results) };
  });
  const report = results.lighthouse;
  if (report) {
    const eligible = new Set(report.categories.flatMap((category) => category.auditIds));
    summary.checks = report.checks.filter((check) => eligible.has(check.id) && check.scoreDisplayMode === "binary" && check.score === 1).map((check) => ({
      id: check.id,
      evidenceIds: results.evidence.filter((item) => item.auditId === auditId && (item.checkId === `lighthouse:${check.id}` || item.checkId === "lighthouse:report")).map((item) => item.id),
      text: concise(`Passed: ${check.title.replace(/[.!?]$/, "")}.${check.displayValue ? ` ${check.displayValue}` : ""}`),
      sourceLabel: sourceLabel([{ checkId: "lighthouse:report", collectedAt: report.fetchedAt }], results),
    }));
  }
  return summary;
}
