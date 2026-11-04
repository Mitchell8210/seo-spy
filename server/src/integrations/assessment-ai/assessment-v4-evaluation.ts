import { groupedOpportunityBaseline } from "./assessment-muse-opportunities.js";
import type { OpportunityBundle, TransparencyBundle } from "./assessment-muse.types.js";
import { transparencyBase } from "./assessment-muse-transparency.js";

/** Frozen before live output. Human review criteria, never SEO scoring policy. */
export function prepareV4Comparison(bundle: OpportunityBundle) {
  return {
    version: "assessment-v4-human-comparison-v1",
    baselineIds: groupedOpportunityBaseline(bundle.opportunities),
    candidateGroups: bundle.opportunities.map(item => ({ id: item.id, group: item.group, kind: item.kind })),
    modelSelection: null,
    method: "Two blinded reviewers independently compare the baseline and model lists. Rate each dimension 0-4, select baseline/model/tie, and explain material disagreements. Do not reward novelty, list length or channel quotas.",
    dimensions: ["Evidence grounding", "Business usefulness", "Priority selection and order", "Nonredundancy", "Coverage of important verified issues", "Conditional review handling", "Appropriate abstention under insufficient evidence"],
    hardFailures: ["Invented, duplicated or cross-business/report/evidence IDs", "Duplicated underlying issue groups", "Unavailable measurement treated as failure", "Conditional observation presented as a confirmed deficiency", "Missing mandatory coverage, freshness, audience or source-disagreement caveats", "Changed scores, unsupported edits, approvals or publishing"],
    decisionRules: ["Loading diagnosis and verified posting shortfalls deserve comparison with owner verification and usability reviews; neither a fixed order nor selecting all three is compulsory.",
      "Confirmed versus conditional status, severity, actionability and unknown effort/risk inform usefulness; no commercial benefit or exact implementation cost is established.",
      "A short or empty list is schema-valid. Review whether its omissions are defensible given the evidence; do not infer that abstention is automatically correct or incorrect.",
      "Accept ties and multiple defensible orders. One live sample cannot establish real permutation robustness, stable cost per report or general reasoning quality."],
    costReview: ["Compare full conservative reservation with returned input/output/reasoning tokens and usage-based ledger charge.", "Record unsuccessful or unknown outcomes separately; never replace unknown cost with zero or retry automatically.", "Actual provider billing is unqueried. No workload projection from one sample."],
  };
}

/** Review plan only. Label validation establishes premises, never decision quality. */
export function prepareV5Comparison(bundle: TransparencyBundle) {
  return {
    ...prepareV4Comparison(transparencyBase(bundle)),
    version: "assessment-v5-human-comparison-v1",
    reviewIfOmittedIds: bundle.reviewIfOmittedIds,
    labelReview: [
      "Check selected and omitted reason premises against the verified candidate classification, information group and unknown effort/risk.",
      "Separately judge usefulness: does each label distinguish a meaningful tradeoff or merely restate a generic priority? A valid label does not prove good judgment or actual motive.",
      "Compare important omitted customer-facing concerns, including verified information disagreements; scrutiny never forces selection or rank.",
      "Compare the saved live v4 IDs/order with v5 and the deterministic baseline. Do not reward differences, additional slots or matching the baseline by themselves.",
      "Never retrofit v5 labels to the ID-only v4 response or infer the cause of the v4 omission.",
      "Record schema and semantic failures, publication outcome and retained accounting without retry. Do not treat failed output as a useful consultation.",
      "Compare v4/v5 input, total output and included reasoning tokens, absolute USD estimate and relative cost; payload bytes and reservation alone cannot establish actual inference cost.",
    ],
    limitations: ["Scrutiny draws attention and may influence selection.", "Only the bounded scrutiny set receives omission annotations.", "One sample cannot establish robustness, superiority or stable cost; provider invoices remain unqueried."],
  };
}
