import type { AuditResults } from "../src/contracts/domain.js";
import type { LighthouseReport } from "../src/integrations/lighthouse/types.js";
import { analyzeWebsite } from "../src/integrations/lighthouse/prioritize.js";
import { attachLighthouse } from "../src/integrations/lighthouse/evidence.js";

function fixture(strategy: "mobile" | "desktop" = "mobile") {
  const ids = ["largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "first-contentful-paint", "speed-index", "forced-reflow-insight", "lcp-discovery-insight", "unknown-diagnostic", "interactive"];
  const report: LighthouseReport = {
    provider: "google-pagespeed-insights", strategy, requestedUrl: "https://example.com/", finalUrl: "https://example.com/",
    fetchedAt: "2026-10-30T00:00:00Z", lighthouseVersion: "13.5.0", warnings: [],
    categories: [{ id: "performance", title: "Performance", score: 35, availability: "measured", auditIds: ids }],
    checks: ids.map(id => ({ id, title: id, description: id, score: 0.1, scoreDisplayMode: "numeric", displayValue: null, explanation: null })),
    metrics: [
      { id: ids[0], title: "Largest Contentful Paint", value: 8900, unit: "ms", displayValue: "8.9 s" },
      { id: ids[1], title: "Total Blocking Time", value: 1470, unit: "ms", displayValue: "1,470 ms" },
      { id: ids[2], title: "Cumulative Layout Shift", value: 0.055, unit: "unitless", displayValue: "0.055" },
      { id: ids[3], title: "First Contentful Paint", value: 2900, unit: "ms", displayValue: "2.9 s" },
      { id: ids[4], title: "Speed Index", value: 12100, unit: "ms", displayValue: "12.1 s" },
    ],
  };
  const results: AuditResults = { findings: [], recommendations: [], evidence: [], scores: [] };
  attachLighthouse(results, report, "audit");
  // Exercise reading a legacy report with the original all-low placeholders.
  results.findings.forEach(item => { item.severity = "low"; });
  results.recommendations.forEach(item => { item.recommendedChange = "Legacy guidance"; });
  delete results.websiteAnalysis;
  return results;
}
const severity = (results: AuditResults, id: string) => analyzeWebsite("audit", results).findings.find(item => item.checkId === `lighthouse:${id}`)!.severity;

describe("versioned Website priority analysis", () => {
  it("prioritizes the measured bottlenecks without escalating all findings or changing raw data/scores", () => {
    const results = fixture(); const original = structuredClone(results);
    const analysis = analyzeWebsite("audit", results);
    expect(severity(results, "largest-contentful-paint")).toBe("critical");
    expect(severity(results, "total-blocking-time")).toBe("critical");
    expect(severity(results, "speed-index")).toBe("medium");
    expect(severity(results, "first-contentful-paint")).toBe("medium");
    expect(severity(results, "cumulative-layout-shift")).toBe("low");
    expect(severity(results, "forced-reflow-insight")).toBe("medium");
    expect(severity(results, "lcp-discovery-insight")).toBe("medium");
    expect(severity(results, "unknown-diagnostic")).toBe("low");
    expect(severity(results, "interactive")).toBe("low");
    expect(analysis.recommendations.find(item => item.findingId === analysis.findings.find(f => f.checkId === "lighthouse:total-blocking-time")!.id)!.recommendedChange).toMatch(/1,470 ms.*Profile long JavaScript tasks/);
    expect(analysis.priorities.every(item => item.reason && item.evidenceIds.length)).toBe(true);
    expect(results).toEqual(original);
    expect(analyzeWebsite("audit", { ...results, findings: analysis.findings, recommendations: analysis.recommendations })).toEqual(analysis);
  });

  const ranges: [string, "mobile" | "desktop", number, number, "critical" | "medium"][] = [
    ["largest-contentful-paint", "mobile", 2500, 4000, "critical"], ["largest-contentful-paint", "desktop", 1200, 2400, "critical"],
    ["total-blocking-time", "mobile", 200, 600, "critical"], ["total-blocking-time", "desktop", 150, 350, "critical"],
    ["cumulative-layout-shift", "mobile", 0.1, 0.25, "critical"], ["cumulative-layout-shift", "desktop", 0.1, 0.25, "critical"],
    ["first-contentful-paint", "mobile", 1800, 3000, "medium"], ["first-contentful-paint", "desktop", 900, 1600, "medium"],
    ["speed-index", "mobile", 3400, 5800, "medium"], ["speed-index", "desktop", 1300, 2300, "medium"],
  ];
  it.each(ranges)("uses explicit inclusive boundaries for %s on %s", (id, strategy, good, poor, highest) => {
    const results = fixture(strategy); const metric = results.lighthouse!.metrics.find(item => item.id === id)!;
    metric.value = 0; expect(severity(results, id)).toBe("low");
    metric.value = good; expect(severity(results, id)).toBe("low");
    metric.value = good + 0.001; expect(severity(results, id)).toBe("medium");
    metric.value = poor; expect(severity(results, id)).toBe("medium");
    metric.value = poor + 0.001; expect(severity(results, id)).toBe(highest);
  });

  it.each([null, NaN, Infinity, -1])("does not promote unavailable or invalid measurements: %s", value => {
    const results = fixture(); results.lighthouse!.metrics[0].value = value;
    expect(severity(results, "largest-contentful-paint")).toBe("low");
    expect(severity(results, "lcp-discovery-insight")).toBe("low");
  });
  it.each(["manual", "notApplicable", "informative", "error"])("does not promote a %s outcome even with a poor numeric metric", mode => {
    const results = fixture(); results.lighthouse!.checks[0].scoreDisplayMode = mode;
    expect(severity(results, "largest-contentful-paint")).toBe("low");
    expect(severity(results, "lcp-discovery-insight")).toBe("low");
  });
  it("requires category membership, matching evidence and metric units, not just a low overall score", () => {
    const results = fixture(); results.lighthouse!.metrics[0].unit = "unitless";
    results.lighthouse!.categories[0].score = 0;
    expect(severity(results, "largest-contentful-paint")).toBe("low");
    results.lighthouse!.categories[0].auditIds = [];
    expect(analyzeWebsite("audit", results).priorities).toEqual([]);
    const noEvidence = fixture(); noEvidence.evidence = [];
    expect(analyzeWebsite("audit", noEvidence).priorities).toEqual([]);
    expect(analyzeWebsite("other-audit", fixture()).priorities).toEqual([]);
  });
  it("leaves HTML-only reports and unrelated findings alone", () => {
    const results = fixture(); delete results.lighthouse;
    expect(analyzeWebsite("audit", results).findings).toEqual(results.findings);
    expect(analyzeWebsite("audit", null).findings).toEqual([]);
  });
});
