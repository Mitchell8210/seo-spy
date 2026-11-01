# SEO Spy scoring policy — discussion draft

Date: October 31, 2026. Historical discussion draft. The user subsequently approved this complete draft as written; see [approved policy and implementation](SCORING_POLICY.md). The original proposal wording is preserved below for context.

This draft turns work package D in `server/AI_AGENT_INTEGRATION_PLAN.md` into reviewable rules. It does not enable scores, model calls, external edits, or frontend changes. Product weights and thresholds below are proposals, not industry standards or empirically calibrated ranking predictions.

## 1. Meaning and overall formula

Measure observed digital-presence quality for the named website page, Facebook Page, and confirmed business facts within declared coverage. A score does not predict search position, traffic, revenue, or compliance. Initial website coverage is one homepage, not the entire website.

Proposed baseline:

`Overall = 0.50 × Website + 0.30 × Social + 0.20 × Consistency`

Each component ranges from 0 to 100. All three must be eligible for an overall score. Publish eligible components independently when another is unavailable; the overall value remains null. Never redistribute a missing channel's weight. Example: W=80, S=60, C=90 yields 76. An unavailable Social component yields a null overall, not a two-channel average.

## 2. Website baseline

`Website = 0.50 × Lighthouse SEO + 0.25 × Lighthouse Performance + 0.15 × Lighthouse Accessibility + 0.10 × Lighthouse Best Practices`

Use the saved measured category scores in their existing 0–100 scale. Require exactly one valid measurement per category from the same live audit, page, strategy, and Lighthouse run. Missing, duplicate, nonfinite, out-of-range, or unavailable categories block this component; a measured zero is valid.

Use mobile for the first default profile. Preserve desktop as a separately identified profile; do not silently mix mobile and desktop measurements or compare them as equivalent improvements. Record Lighthouse version and tested URL. Retain each original category score separately.

Direct HTML checks, issue counts, severity labels, and related diagnostics do not add extra deductions to this aggregate. They support recommendations, avoiding a second deduction for checks already represented by Lighthouse. This first formula measures the selected Lighthouse categories; it does not claim content quality or sitewide SEO coverage.

## 3. Social baseline

Start with Facebook only and identify that scope explicitly.

`Social = 0.60 × Profile Readiness + 0.40 × Publishing Consistency`

### Profile readiness

| Criterion | Weight | Pass rule |
| --- | ---: | --- |
| Business name | 20% | Confirmed visible, nonempty business name |
| Business description | 20% | Confirmed visible, nonempty about or description field; either satisfies this one criterion |
| Website link | 20% | Confirmed visible HTTP(S) business website link |
| Contact route | 20% | At least one confirmed visible phone number or email address |
| Business category | 20% | Confirmed visible, nonempty business category |

Each criterion earns all its points on pass, zero on confirmed failure, and unknown when evidence cannot establish either. Presence belongs here; agreement with preferred values belongs in Consistency. A populated but mismatched phone does not also lose profile-readiness points.

API omission, null, or the existing collector's `missing` flag alone is insufficient proof of visible absence. Define a reliable source or separately recorded confirmation before converting that state into a scored failure. Unknown criteria block this component in the first version. Every criterion is required; no silent exclusions or redistribution.

### Publishing consistency

Use four consecutive complete seven-day periods ending at the assessment's recorded UTC cutoff. Obtain a business-confirmed target number of posts per period before scoring; one post per period is a suggested starting target for review, not an assumed universal requirement.

For target T > 0 and each period's complete observed post count N:

`Period attainment = min(N / T, 1)`

`Publishing Consistency = 100 × mean(the four period attainments)`

Example with confirmed T=1 and counts [1, 0, 2, 1]: attainment [1, 0, 1, 1], score 75. Extra posts cannot erase an inactive period. With Profile Readiness=100, Social=90.

Require complete coverage of all four periods, trustworthy timestamps, known collection bounds, and no truncation. Partial samples cannot establish a zero-post period. Missing coverage or an absent confirmed target produces an unknown publishing score and null Social score. A business that has not chosen a publishing goal receives recommendations without an invented score.

Follower count, verification badge, star rating, reach, views, and engagement do not contribute to this baseline. Their interpretation needs separate business targets and comparable historical evidence.

## 4. Business consistency

Compare Website and Facebook observations against a versioned, business-confirmed preferred-value record.

| Criterion | Weight | Pass rule |
| --- | ---: | --- |
| Business name | 20% | Both sources match the preferred name or an explicitly confirmed alias |
| Phone | 30% | Both sources expose an approved business phone after country-aware normalization |
| Website URL | 30% | Facebook link and registered Website identity match an approved canonical destination |
| Hours | 20% | Both sources agree with confirmed hours, timezone, and relevant date scope |

Use pass=1, confirmed fail=0, unknown=no numeric judgment. A confirmed mismatch is one criterion failure regardless of how many strings or findings describe it. Missing observations are unknown unless absence itself is confirmed and the business requires that field on both sources.

`Consistency = 100 × sum(applicable weight × outcome) / sum(applicable weight)`

Initially require every applicable criterion to be known. Exclude a criterion only through recorded business confirmation before assessment, such as a business that does not publish operating hours. Record the changed denominator and applicability profile. Unknown is never not-applicable. At least business name and website URL must remain applicable and known; all-excluded scoring is invalid. Compare histories only under the same applicability profile.

Do not assume every telephone digit string or www/non-www hostname is equivalent. Country and accepted phone values must be known; canonical aliases must be registered or verified. Do not let a model decide identity equivalence without validated evidence.

Current homepage evidence may not establish comparable name, phone, or hours. Add explicit extraction/confirmation contracts before implementing this component; scattered HTML text is not automatically an authoritative business fact.

## 5. Rank Math supporting contribution

The accepted direction is a small numeric supporting contribution. Proposed ceiling: **5% of Website**, equivalent to at most **2.5 points of Overall** under the 50/30/20 profile.

Do not append an unqualified average of the current bounded page/post sample. Current stored-score dates are unknown, sampling is not representative, and SEO checks may overlap with Lighthouse. These prevent a defensible contribution today.

Proposed delivery sequence:

1. Implement the baseline above with Rank Math evidence available for recommendations and its native scores preserved separately.
2. Define a separately versioned Rank Math profile after selecting representative content, freshness eligibility, aggregation, and overlap rules. Candidate formula: `Website_RM = 0.95 × Website_baseline + 0.05 × RankMath_support`.
3. Do not enable that candidate formula until overlap rules establish that the supporting signal adds eligible distinct evidence. Its 5% weight bounds influence but does not itself solve double-counting.
4. An explicitly requested Rank Math profile with missing evidence is unavailable; never treat missing values as zero or silently switch profiles. Businesses without the plugin can use the baseline profile, whose scores are identified separately. Cross-profile differences are policy changes, not improvements.

This profile approach is proposed for approval. It makes missing-plugin behavior explicit without inventing a neutral plugin score, awarding a plugin-installation bonus, or silently changing weights. The current sample remains recommendation evidence until its numeric eligibility is established.

## 6. Freshness and evidence matching

Proposed initial limits: each selected source report collected within seven days of the assessment cutoff, with at most 72 hours between source collection times. Validate against actual collection dates, not file modification times. Future timestamps or missing/unparseable timestamps are ineligible. These are product-policy choices requiring review.

Each source must match the same registered business, expected asset, supported schema, and live mode. Exclude demo reports. Select one immutable report per required source and save why it was selected; do not assemble a component opportunistically from unrelated historical runs. A partial audit is usable only if every required input to that component is valid.

Assessment scores describe their recorded cutoff. Preserve historical snapshots when they age; a latest-read model may identify stale inputs without rewriting the old result. A fresh assessment must recheck eligibility against its own cutoff. Do not contact providers merely to calculate or read a score.

## 7. Arithmetic and score ledger

- Validate every input and weight before calculation; reject malformed policy totals rather than clipping bad values.
- Use exact fixed-point/rational arithmetic, or an equivalent defined precision contract. Store original values, weights, numerators, denominators, and unrounded component contributions.
- Round only the final displayed score, half up to the nearest integer. The overall calculation uses unrounded components, not their display values.
- Persist policy version/hash, profile, applicability, confirmed target/fact revisions, source report hashes/IDs, evidence references, collection dates, cutoff, device strategy, coverage, criterion outcomes, and explicit reason codes.
- Reasons include missing evidence, unconfirmed business facts/goal, incomplete post window, stale input, source-time mismatch, invalid measurement, and unsupported policy/profile.
- Coverage is separate from quality. Require 100% of applicable required criteria for the initial policy; record known/required weight even when no score is eligible.
- Muse may explain the accepted ledger and propose recommendations. Numeric scores in this first version use deterministic rules only; model confidence and uncalibrated qualitative judgments do not change arithmetic.

## 8. Implementation slice after policy review

1. Add a pure, independently testable calculator and policy schema under `server/src/scoring/`. Keep draft policy disabled until accepted.
2. Build source adapters with explicit unknown states; implement Website first because its required measurements already exist. Record gaps for Social and Consistency rather than fabricating compatible inputs.
3. Test exact examples, measured zero, nulls, complete/incomplete windows, truncation, duplicate findings, equivalent contacts, changed confirmed facts, applicability, stale/future timestamps, source mismatch, decimal rounding, and replay across policy versions.
4. Add a separate score snapshot/read contract with source manifest and ledger, deliberately updating DTOs/OpenAPI/persistence. Retain immutable original reports and legacy availability semantics until a compatible migration is implemented.
5. Connect accepted calculated values to existing frontend fields in a separately scoped integration. No score publication, UI changes, model spend, new scans, or WordPress writes are included in this policy draft.

## 9. Decisions for review

- Overall balance: proposed 50/30/20; alternative website-heavy 70/15/15.
- Website category weights: proposed 50/25/15/10 and mobile default.
- Social scope/rubric: Facebook profile readiness plus publishing against a business-confirmed goal.
- Consistency criteria, confirmed-value requirements, and explicit applicability handling.
- Strict initial coverage, seven-day freshness, and 72-hour source skew.
- Rank Math: proposed 5% Website ceiling, baseline first, with a separately eligible profile later.

Approving the overall weights alone does not approve every threshold or rubric in this draft. Iterate on the policy before releasing numeric scores.
