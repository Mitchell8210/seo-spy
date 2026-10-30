import type { AuditResults, Finding, Recommendation, Severity } from "../../contracts/domain.js";

export interface PriorityDecision {
  findingId: string;
  ruleId: string;
  severity: Severity;
  reason: string;
  evidenceIds: string[];
}
export interface WebsiteAnalysis {
  version: "website-priority-v1";
  auditId: string;
  findings: Finding[];
  recommendations: Recommendation[];
  priorities: PriorityDecision[];
}

// Google Lighthouse rating ranges. SEO Spy's priority mapping is a separate,
// versioned policy, not a Google severity or a recalculation of category scores.
const metrics = {
  "largest-contentful-paint": { mobile: [2500, 4000], desktop: [1200, 2400], unit: "ms", primary: true,
    action: "Inspect the largest visible image or text block and its loading timeline. If it is an image, check its dimensions, compression and loading priority; avoid lazy-loading the main visible image. Check server response and render-blocking resources before choosing a fix." },
  "total-blocking-time": { mobile: [200, 600], desktop: [150, 350], unit: "ms", primary: true,
    action: "Profile long JavaScript tasks during page load. Identify the scripts responsible, split long tasks and defer nonessential scripts or third-party widgets after checking which page features depend on them." },
  "cumulative-layout-shift": { mobile: [0.1, 0.25], desktop: [0.1, 0.25], unit: "unitless", primary: true,
    action: "Inspect which elements move during loading. Reserve space for images, embeds and banners, and check font loading before changing the elements responsible for the shifts." },
  "first-contentful-paint": { mobile: [1800, 3000], desktop: [900, 1600], unit: "ms", primary: false,
    action: "Inspect the initial document response, critical styles and font loading. Reduce confirmed render-blocking work and deliver the initial visible content before nonessential resources." },
  "speed-index": { mobile: [3400, 5800], desktop: [1300, 2300], unit: "ms", primary: false,
    action: "Review the loading filmstrip to find what delays visible content. Prioritize the resources needed above the fold and defer offscreen images and nonessential scripts where appropriate." },
} as const;

const diagnostics: Record<string, { related: string[]; action: string }> = {
  "forced-reflow-insight": { related: ["total-blocking-time"], action: "Use a performance trace to locate scripts that repeatedly read layout after changing page styles. Batch layout reads and writes and verify that the change reduces the recorded long tasks." },
  "network-dependency-tree-insight": { related: ["largest-contentful-paint"], action: "Inspect the critical request chain. Remove unnecessary dependencies and defer noncritical resources only after confirming they delay the main visible content." },
  "lcp-breakdown-insight": { related: ["largest-contentful-paint"], action: "Inspect the largest-content loading breakdown to identify whether server response, resource discovery, download or rendering is the main delay. Address that phase first." },
  "lcp-discovery-insight": { related: ["largest-contentful-paint"], action: "Check whether the main visible image is discoverable in the initial HTML. If it is loaded late, expose it earlier and review its loading priority; avoid adding preload hints without confirming the actual resource." },
  "render-blocking-insight": { related: ["largest-contentful-paint", "first-contentful-paint"], action: "Inspect the resources reported as blocking initial rendering. Defer noncritical scripts and styles while preserving the styles needed for the first visible content." },
  "image-delivery-insight": { related: ["largest-contentful-paint"], action: "Inspect the flagged images and their displayed dimensions. Serve appropriately sized compressed images and confirm whether the main visible image is among the flagged resources." },
  "unused-javascript": { related: ["total-blocking-time"], action: "Use script coverage and the loading trace to identify unused code. Remove or defer code only after verifying that it is not required for page features." },
  "mainthread-work-breakdown": { related: ["total-blocking-time"], action: "Inspect the main-thread work breakdown and long-task trace. Reduce the confirmed scripting, layout or rendering work rather than assuming a particular plugin is responsible." },
};

const metricRule = (id: string) => Object.hasOwn(metrics, id) ? metrics[id as keyof typeof metrics] : undefined;

export function analyzeWebsite(auditId: string, results: AuditResults | null): WebsiteAnalysis {
  const output: WebsiteAnalysis = { version: "website-priority-v1", auditId,
    findings: results?.findings.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds] })) ?? [],
    recommendations: results?.recommendations.map((item) => ({ ...item })) ?? [], priorities: [] };
  const report = results?.lighthouse;
  if (!results || !report) return output;
  const performance = report.categories.find((item) => item.id === "performance");
  const eligible = new Set(performance?.auditIds ?? []);
  const measured = (id: string) => {
    const rule = metricRule(id);
    const metric = report.metrics.find((item) => item.id === id);
    const check = report.checks.find((item) => item.id === id);
    return rule && eligible.has(id) && check && ["numeric", "binary"].includes(check.scoreDisplayMode) &&
      check.score != null && Number.isFinite(check.score) && check.score >= 0 && check.score <= 1 &&
      metric?.value != null && Number.isFinite(metric.value) && metric.value >= 0 && metric.unit === rule.unit ? metric : null;
  };
  for (const finding of output.findings) {
    const id = finding.checkId.replace(/^lighthouse:/, "");
    const check = report.checks.find((item) => item.id === id);
    const evidence = results.evidence.filter((item) => item.auditId === auditId && finding.evidenceIds.includes(item.id) && item.checkId === finding.checkId);
    if (finding.auditId !== auditId || finding.source !== "website" || !finding.checkId.startsWith("lighthouse:") ||
        !eligible.has(id) || !check || !["numeric", "binary"].includes(check.scoreDisplayMode) ||
        check.score === null || !Number.isFinite(check.score) || check.score < 0 || check.score >= 1 || !evidence.length) continue;
    const rule = metricRule(id);
    const metric = measured(id);
    let severity: Severity = finding.severity;
    let reason = "";
    let action = "";
    if (rule && metric) {
      const [good, poor] = rule[report.strategy];
      severity = metric.value! > poor ? rule.primary ? "critical" : "medium" : metric.value! > good ? "medium" : "low";
      reason = `${metric.title}: ${metric.value} ${metric.unit} in the ${report.strategy} lab run; good <= ${good}, poor > ${poor}. ${rule.primary ? "Primary" : "Supporting"} metric priority policy.`;
      action = `${metric.title} measured ${metric.displayValue || `${metric.value} ${metric.unit}`} in this ${report.strategy} lab run. ${rule.action}`;
    } else if (Object.hasOwn(diagnostics, id)) {
      const diagnostic = diagnostics[id];
      const related = diagnostic.related.filter((key) => {
        const relatedRule = metricRule(key)!;
        const relatedMetric = measured(key);
        return eligible.has(key) && relatedMetric && relatedMetric.value! > relatedRule[report.strategy][1];
      });
      severity = related.length ? "medium" : "low";
      reason = related.length ? `Failed diagnostic related to poor measured ${related.join(", ")}; investigate relevance, not a confirmed cause.` : "Failed diagnostic without a corroborating poor related metric; review before escalating.";
      action = diagnostic.action;
    }
    if (!reason) continue;
    finding.severity = severity;
    output.priorities.push({ findingId: finding.id, ruleId: id, severity, reason, evidenceIds: [...finding.evidenceIds] });
    for (const recommendation of output.recommendations.filter((item) => item.findingId === finding.id && item.auditId === auditId)) {
      recommendation.recommendedChange = `${action} Re-run Lighthouse with the same device strategy to verify the result.`;
      recommendation.purpose = "Improve the measured page experience after confirming the cause; verify with a comparable lab run.";
    }
  }
  return output;
}
