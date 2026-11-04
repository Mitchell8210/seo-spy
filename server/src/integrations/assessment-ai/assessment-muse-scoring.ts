import { createHash } from "node:crypto";
import type { AuditReportRecord } from "../../reports/report.types.js";
import type { CriterionLedger, ExactScore, ScoreCategory, ScoreEvidenceRef, ScoreSnapshot } from "../../scoring/scoring.types.js";
import { SOCIAL_PERFORMANCE_POLICY } from "../../scoring/social-performance.policy.js";
import { assessmentScoringContextSchema, type AssessmentScoringContext, type ScoringObservation } from "./assessment-muse.types.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const numeric = (value: ExactScore | null) => value === null ? null : Number(value.numerator) / Number(value.denominator);
const labels: Record<string, string> = { seo: "Search engine checks", performance: "Performance", accessibility: "Accessibility checks", "best-practices": "Best practices", name: "Business name", phone: "Phone", url: "Website address", hours: "Opening hours", "business-name": "Business name", "website-url": "Website address", description: "Profile description", "website-link": "Website link", "contact-route": "Contact route", category: "Business category" };
const label = (id: string) => labels[id] ?? id;
const gapExplanation = (id: string) => ({
  "shares-per-100-followers": "Complete timestamped shares for the reporting period are not established; lifetime shares cannot fill this gap.",
  "follower-growth-percent": "Comparable follower snapshots at both reporting boundaries are needed before growth can be assessed.",
  "reviewed-relevance": "Content relevance and factual usefulness have not received a supported review; text patterns cannot establish them.",
  "customer-response-rate": "Eligible inquiries paired with business responses are not established. Conversation counts do not show response coverage.",
  "customer-response-hours": "Paired inquiry and response timestamps are not established. A conversation count does not show response speed.",
}[id] ?? "The saved evidence does not establish this measure. Check the recorded access, coverage and freshness limitations; this is not proof of poor performance.");
const uniqueRefs = (refs: ScoreEvidenceRef[]) => [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()];

/** Presentation of a replay-validated snapshot, never a second scoring calculator.
 * No account strings, source HTML, preferred values or contact details are copied.
 */
export function buildAssessmentScoringContext(snapshot: ScoreSnapshot, reports: AuditReportRecord[]): AssessmentScoringContext {
  if (snapshot.sources.length !== reports.length || snapshot.sources.some(source => {
    const report = reports.find(item => item.reportId === source.reportId);
    return !report || report.business.id !== snapshot.businessId || report.audit.businessId !== snapshot.businessId || digest(report) !== source.reportHash;
  })) throw new Error("Scoring context does not match its pinned reports.");
  const resolve = (refs: ScoreEvidenceRef[]): ScoreEvidenceRef[] => {
    if (refs.some(ref => {
      const report = reports.find(item => item.reportId === ref.reportId);
      const source = snapshot.sources.find(item => item.reportId === ref.reportId);
      if (!report || !source?.evidenceIds.includes(ref.evidenceId)) return true;
      if (report.results?.evidence.some(item => item.id === ref.evidenceId && item.auditId === report.auditId && item.mode === "live")) return false;
      // Historical scoring adapters use these exact synthetic, report-bound citations.
      if (ref.evidenceId.startsWith("lighthouse-category:")) return !report.results?.lighthouse?.categories.some(item => ref.evidenceId === `lighthouse-category:${item.id}` && item.availability === "measured");
      if (ref.evidenceId.startsWith("facebook-profile:")) return report.results?.facebook?.profile[ref.evidenceId.slice("facebook-profile:".length)]?.status !== "available";
      if (ref.evidenceId === "facebook-posts") return !report.results?.facebook?.posts;
      return true;
    })) throw new Error("Scoring context contains an unresolved citation.");
    // Never silently trim evidence needed to support an observation.
    const result = uniqueRefs(refs);
    return result.length <= 4 ? result : [];
  };
  const observations: ScoringObservation[] = [];
  const gaps: AssessmentScoringContext["measurementGaps"] = [];
  const addObservation = (observation: ScoringObservation) => { if (observation.evidenceRefs.length) observations.push(observation); };
  const components: AssessmentScoringContext["components"] = [];
  for (const category of ["website", "social", "consistency", "overall"] as const) {
    const score = snapshot.scores[category];
    const breakdown: AssessmentScoringContext["components"][number]["breakdown"] = [];
    if (category === "social" && snapshot.socialAssessment) {
      const social = snapshot.socialAssessment;
      for (const group of social.categories) {
        breakdown.push({ id: group.id, label: group.label, maximumPoints: group.maximum, earnedPoints: group.earned,
          score: null, knownWeight: group.evidencedWeight, applicableWeight: group.applicableWeight, status: group.status,
          reasonCodes: [...new Set(group.criteria.flatMap(item => item.reason ? [item.reason] : []))].slice(0, 8) });
        for (const item of group.criteria) {
          if (item.status === "unavailable") { gaps.push({ category, id: item.id, label: item.label, explanation: gapExplanation(item.id), reasonCode: item.reason ?? "METRIC_NOT_AVAILABLE" }); continue; }
          if (item.status !== "available" || item.earned === null || item.value === null) continue;
          const refs = resolve(item.evidence);
          const strength = item.earned === item.maximum;
          // Labels/units/recommendations come from trusted policy, not scraped strings.
          const definition = SOCIAL_PERFORMANCE_POLICY.categories.flatMap(entry => entry.criteria).find(entry => entry.id === item.id);
          if (!definition) continue;
          const value = Number.isInteger(item.value) ? String(item.value) : `${Number(item.value.toPrecision(4))} (rounded)`;
          addObservation({ id: `score:social:${item.id}`, category, kind: strength ? "strength" : "weakness",
            statement: `${definition.label}: ${value} ${definition.unit}; ${item.earned}/${item.maximum} points under the saved policy.`.slice(0, 240), evidenceRefs: refs,
            nextStep: strength ? null : { title: `Improve ${definition.label.toLowerCase()}`, text: definition.recommendation.slice(0, 360),
              verification: "Compare the same measure and reporting period in a later explicitly requested report. Confirm coverage before comparing results.",
              effort: "unknown", risk: "unknown", severity: group.id === "posting-consistency" || group.id === "audience-engagement" ? "medium" : "low",
              shortfallPoints: item.maximum - item.earned },
          });
        }
      }
    } else if (category !== "overall") {
      for (const row of score.ledger) {
        breakdown.push(compactRow(row, category === "consistency"));
        if (row.exact === null) { if (row.originalValue !== "not-applicable") gaps.push({ category, id: row.id, label: label(row.id), explanation: gapExplanation(row.id), reasonCode: row.reasons[0] ?? "MISSING_EVIDENCE" }); continue; }
        const refs = resolve(row.evidence);
        if (!refs.length) continue;
        const value = numeric(row.exact)!;
        const strength = value === 100;
        // Category results do not establish a specific technical cause or authorize a fix.
        const statement = category === "website" ? `${label(row.id)}: ${row.originalValue}/100 in the saved ${snapshot.profile === "baseline-mobile-v1" ? "mobile" : "desktop"} Lighthouse run. This covers the recorded page only.`
          : category === "consistency" ? `${label(row.id)}: the saved comparison ${strength ? "passes" : "does not pass"}. ${snapshot.consistencyBasis === "source-agreement" ? "Source agreement does not establish which value is correct." : "This comparison uses the recorded confirmed facts."}`
            : `${label(row.id)}: ${value}/100 under the saved profile-readiness policy; this does not measure audience performance.`;
        addObservation({ id: `score:${category}:${row.id}`, category, kind: strength ? "strength" : "weakness", statement, evidenceRefs: refs, nextStep: null });
      }
    }
    components.push({ category, value: score.value, availability: score.availability, knownWeight: score.coverage.knownWeight,
      requiredWeight: score.coverage.requiredWeight, reasonCodes: score.reasons.slice(0, 8), breakdown: breakdown.slice(0, 6) });
  }
  // Reserve room for both strengths and shortcomings, then the other channels.
  const selected: ScoringObservation[] = [];
  const select = (items: ScoringObservation[], maximum: number) => {
    for (const item of items.slice(0, maximum)) if (!selected.includes(item) && selected.length < 12) selected.push(item);
  };
  const weaknesses = observations.filter(item => item.kind === "weakness").sort((a, b) => (b.nextStep?.shortfallPoints ?? 0) - (a.nextStep?.shortfallPoints ?? 0));
  select(weaknesses, 5);
  select(observations.filter(item => item.kind === "strength"), 3);
  for (const category of ["website", "social", "consistency"] as ScoreCategory[]) select(observations.filter(item => item.category === category && !selected.includes(item)), 2);
  return assessmentScoringContextSchema.parse({ policyHash: snapshot.policyHash, asOf: snapshot.cutoff, components,
    socialStatus: snapshot.socialAssessment?.status ?? null, socialCoveragePercent: snapshot.socialAssessment?.coveragePercent ?? null,
    observations: selected, omittedObservations: observations.length - selected.length,
    measurementGaps: gaps.slice(0, 12), omittedMeasurementGaps: Math.max(0, gaps.length - 12), limitations: [
      "Scores and points are copied from the saved deterministic snapshot, not recalculated. Interpret them as of the recorded cutoff, not current conditions.",
      "Category earned points and evidence coverage are separate; unavailable measurements are not failures or zero. Social category points are not normalized category scores.",
      "Social thresholds are provisional product targets, not industry standards. Content structure is a proxy, not proof of relevance, correctness or usefulness.",
      "Likes/comments per current follower measure action density, not unique engagement. Media views are non-unique, not people reached; repeats and ads may contribute.",
      "A score shortfall does not identify its cause, expected business outcome or exact editable target. Recommendations grant no approval or execution capability.",
      "Selected observations and gaps are bounded; omission does not mean a passing check. Missing measurements may require access or future evidence rather than a business change.",
    ] });
}

function compactRow(row: CriterionLedger, normalizedApplicability: boolean): AssessmentScoringContext["components"][number]["breakdown"][number] {
  // Consistency contributions may use an attested applicability denominator.
  // Do not manufacture a normalized per-row maximum from a native policy weight.
  return { id: row.id, label: label(row.id), maximumPoints: normalizedApplicability ? null : row.weight, earnedPoints: numeric(row.contribution), score: numeric(row.exact),
    knownWeight: row.exact === null ? 0 : row.weight, applicableWeight: row.weight, status: row.originalValue === "not-applicable" ? "not_applicable" : row.exact === null ? "unavailable" : "available", reasonCodes: row.reasons.slice(0, 8) };
}
