/** Explicit synthetic offline fixtures, never real application reports. */
import { ASSESSMENT_MUSE_V4, assessmentMuseEvidenceSchema, type Opportunity, type OpportunityBundle } from "../assessment-muse.types.js";
import { opportunityId } from "../assessment-muse-opportunities.js";

export interface SyntheticOpportunityScenario {
  id: string;
  candidates: { id: string; group: string; category: "website" | "social" | "consistency"; severity: "critical" | "medium" | "low"; statement: string; action: string; kind: "confirmed" | "conditional-review"; eligible: boolean }[];
  mandatoryContext?: { statement: string }[];
  measurementGaps?: string[];
}
export function syntheticOpportunityBundle(scenario: SyntheticOpportunityScenario): OpportunityBundle {
  const cutoff = "2026-11-01T19:52:03.282Z";
  const reportId = (category: string) => `synthetic-offline:${scenario.id}:${category === "social" ? "facebook" : "website"}`;
  const groups = new Set<string>();
  const pool: Opportunity[] = scenario.candidates.filter(item => item.eligible).filter(item => {
    if (groups.has(item.group)) return false; groups.add(item.group); return true;
  }).map(item => {
    const id = opportunityId(item.group), evidenceRefs = [{ reportId: reportId(item.category), evidenceId: `synthetic-offline:proof:${item.id}` }];
    if (item.category === "consistency") evidenceRefs.push({ reportId: reportId("social"), evidenceId: `synthetic-offline:proof:${item.id}` });
    return { id, group: item.group, kind: item.kind, severity: item.severity, statement: item.statement,
      action: { id, reportId: evidenceRefs[0].reportId, findingId: `synthetic:${item.id}`, title: `Review ${item.group}`, recommendation: item.action, rationale: item.statement,
        effort: "unknown", risk: "unknown", evidenceRefs, verificationSteps: ["Verify the same synthetic observation after any separately approved change."], manualFallback: "Review the saved synthetic evidence manually; no action is authorized.",
        origin: { kind: "scoring-observation", category: item.category, sourceRefs: evidenceRefs } } };
  });
  const categories = ["website", "social", "consistency", "overall"] as const;
  const parsed = assessmentMuseEvidenceSchema.parse({ schemaVersion: "seo-spy.assessment-muse-evidence.v4", assessmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", businessId: `synthetic:${scenario.id}`,
    policyVersion: "synthetic-offline-not-scoring-policy", cutoff, selectionVersion: ASSESSMENT_MUSE_V4.selection,
    sources: ["website", "facebook"].map(provider => ({ reportId: reportId(provider === "facebook" ? "social" : "website"), contentHash: "0".repeat(64), provider, collectedAt: cutoff, status: "partial" })),
    scores: categories.map(category => ({ category, value: null, reasonCodes: ["SYNTHETIC_OFFLINE"] })), findings: [],
    coverage: { selectedFindings: 0, omittedFindings: 0, limitations: ["SYNTHETIC OFFLINE FIXTURE. Not Guzman evidence or an application report."] },
    scoringContext: { policyHash: "0".repeat(64), asOf: cutoff,
      components: categories.map(category => ({ category, value: null, availability: "unavailable", knownWeight: 0, requiredWeight: 100, reasonCodes: [], breakdown: [] })),
      socialStatus: "insufficient_data", socialCoveragePercent: null, observations: [], omittedObservations: 0, omittedMeasurementGaps: 0,
      measurementGaps: (scenario.measurementGaps ?? []).map((explanation, index) => ({ category: "social", id: `gap:${index}`, label: "Synthetic measurement gap", reasonCode: "SYNTHETIC_UNAVAILABLE", explanation })),
      limitations: ["SYNTHETIC OFFLINE FIXTURE. Scores and commercial outcomes are not established."] },
    businessContext: { facts: [...pool.map(item => ({ id: item.action.findingId, category: item.action.origin.category, kind: "weakness", group: item.group, text: item.statement, evidenceRefs: item.action.evidenceRefs })),
      ...(scenario.mandatoryContext ?? []).map((item, index) => ({ id: `context:${index}`, category: "social", kind: "context", group: "audience", text: item.statement, evidenceRefs: [{ reportId: reportId("social"), evidenceId: "synthetic-offline:proof:audience" }] }))],
      measures: [], overallContributions: [], executiveAssessment: "Priorities are rendered from the selected synthetic opportunities.", scoringExplanation: "Synthetic offline fixture. No numerical SEO Spy scores, weights or business outcomes are established or changed.", recommendations: [] },
    opportunities: pool });
  if (parsed.schemaVersion !== "seo-spy.assessment-muse-evidence.v4") throw new Error("Synthetic version mismatch.");
  return parsed;
}
