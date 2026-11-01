# Approved SEO Spy scoring policy v1

The user approved the complete [discussion draft](SCORING_POLICY_DRAFT.md) on October 31, 2026. The implementation is `src/scoring/policy.ts` and `calculator.ts`; `GET /api/scoring-policy` exposes the version and SHA256 policy hash. These product rules measure declared observations, not rankings, revenue, compliance or an entire website.

## Arithmetic and eligibility

- Overall: Website 50%, Social 30%, Consistency 20%. All three must be eligible. Missing weights never move to another component.
- Website: Lighthouse SEO 50%, Performance 25%, Accessibility 15%, Best Practices 10%. Require all four measured categories from one live run, page, strategy and version. Mobile and desktop have separately identified profiles. Zero is valid; null, duplicates, invalid ranges or incompatible runs are unavailable. HTML findings do not cause extra deductions.
- Social: Facebook Profile Readiness 60%, Publishing Consistency 40%. Profile criteria (20% each) are visible business name, description/about, website link, phone/email contact and category. Available populated values can pass. API omission alone cannot fail; a separately recorded, evidence-linked visible-absence confirmation is required.
- Publishing uses four complete consecutive seven-day periods ending at the recorded UTC cutoff, with a business-confirmed positive target T. Each period earns `min(N/T,1)`; average the four attainments and multiply by 100. No complete coverage, unknown timestamps, truncation or an unconfirmed goal means unavailable. Extra posts cannot erase an inactive period.
- Consistency compares observed Website/Facebook name (20%), phone (30%), website (30%) and hours (20%) against versioned confirmed preferences. Every applicable criterion must be known. Explicit confirmed applicability may exclude phone or hours; name and website remain required. Recompute only the explicitly applicable denominator. Unknown is never not-applicable. No automatic www aliases, countryless phone matching or model identity decisions.
- Each source is at most seven days old at cutoff; cross-channel skew is at most 72 hours. Current reads also suppress eligibility after sources age. Saved historical snapshots remain immutable.
- Exact rational arithmetic retains original input/source references, weights, fractions and contributions. Only final displayed values round, half up. Overall uses unrounded components.
- Rank Math remains separately cited supporting evidence. The proposed later 5% Website profile is not enabled: representative sampling, freshness and overlap rules remain required.

## Persistence and API

SQLite schema 3 adds immutable `assessment_records` for assessments, mocked interpretations, confirmed fact revisions and edit-origin links. Existing audit archives/score enums remain unchanged; no new score is written into old reports. Snapshot reads replay the deterministic input/policy and reject incompatible stored results. Checksums, business scope and cache keys protect stored payloads; the AI spending ledger is separate.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/scoring-policy` | Approved policy/hash; no provider calls |
| POST | `/api/businesses/:businessId/assessments` | Local operator, `{confirmed:true, websiteReportId?, facebookReportId?, profile?, cutoff?}`; pins saved reports and persists scores |
| GET | `/api/businesses/:businessId/assessments/latest` | Saved read model with current freshness gates; never creates work |
| GET | `/api/businesses/:businessId/assessments/:id` | Immutable historic input, policy and calculation ledger |
| POST | `/api/businesses/:businessId/scoring-facts` | Local operator confirms preferred facts, publishing target and any separately evidenced absences; immutable revision |
| GET | `/api/businesses/:businessId/scoring-facts` | Operator-only latest confirmed revision |
| POST | `/api/businesses/:businessId/assessments/:id/muse-analyses` | Operator and `{confirmed:true}`; labeled local mock recommendations, exact-input cache, no live dispatch |
| GET | `/api/businesses/:businessId/assessments/:id/muse-analyses/:analysisId` | Operator-only saved interpretation; no generation |

Operator routes reuse server-only `WORDPRESS_OPERATOR_KEY` and the configured business binding. Never put it in browser code. The unguarded saved read models remain local application reads, not public multi-tenant authorization. Website audit completion publishes a separate deterministic snapshot after its immutable report is saved; a score publication failure does not erase the audit or trigger retries. Existing records can be assessed explicitly without another scan.

The dashboard reads the latest snapshot through its existing business response. Only scores whose pinned source IDs match the currently displayed reports populate its existing gauges. Unknown channels keep the existing unavailable treatment. Saved interpretation prose may replace a matching linked recommendation only when citations resolve; mock recommendations carry an explicit mock label. Neither viewing reports nor scores generates AI.

## Confirmed facts and current data gaps

The request schema is `modules/assessments/confirmed-facts.ts`. It records the operator actor/time, preferred name/aliases, country-aware approved E164 phones, `phoneApplicable` (defaults true), canonical website destinations, timezone/`hoursApplicable`, a nullable publishing target and optional cited visible-absence confirmations. Nothing is inferred as business approval. Confirmations do not silently recalculate old snapshots; create a new assessment after a revision.

New homepage collections record bounded schema.org business observations as `business-facts` evidence. No additional crawl is triggered by scoring. Old reports without comparable observations remain unknown. The adapter requires one unambiguous observed entity and explicit aliases/phone context. Facebook does not currently establish a source timezone/date scope for hours; applicable hours remain unknown. Excluding hours requires an actual business confirmation, not a developer workaround.

A saved bounded Facebook sample may not cover all four periods through a newer assessment cutoff. The current collector's requested window ends near collection start, while field/post observation dates and an assessment cutoff can be later. That ordinary saved report cannot establish complete coverage through the later cutoff. Do not substitute its sample count or silently shift the cutoff to award a score. Confirm a goal and establish a compatible complete-window collection contract before expecting Social/Overall values. Source omissions produce actionable reason codes, not fabricated quality scores.

Website requested/final URLs are checked explicitly. A registered homepage redirect is accepted only with one matching saved `collection` evidence record, a successful response and a bounded recorded redirect chain ending at the exact Lighthouse requested/final page. This is evidence of the collected page binding, not a universal www alias or a business-consistency confirmation.

## Recommendation to edit workflow

Combined Muse interpretation is informational only and never supplies executable patches, target permissions or scores. Mock mode is the only exposed assessment generation path. The adapter supports the central protected provider for a future separately authorized extension, but no live dispatch route is enabled here. The $2/$0.50/ten-call safeguards and default master mock block remain intact.

For the narrow image-alt workflow, use an existing saved **WordPress** Muse analysis with an exact cited media target:

1. `POST /api/wordpress/businesses/:businessId/media-alt-previews` with `{confirmed:true,reportId,analysisId,recommendationId,altText}`. The operator supplies the exact text. Saved recommendation/capability/site/citations are checked, then the current target is read to create an exact 15-minute proposal. No write occurs. Origin and mock provenance are saved separately in SQLite.
2. Review the returned before-state, target, proposed text, expiry and hash. Editing text requires a new proposal/hash.
3. Explicitly call the existing returned `/proposals/:id/apply` path with `{confirmed:true,proposalHash}`. Independent writes-enabled, operator/site/precondition/reservation checks still apply. Replays never repeat a write; unknown outcomes stay locked.
4. Inspect stored-field verification, then explicitly request `/proposals/:id/verifications` with a relevant published page/post ID. A verified stored field and publicly served HTML are separate outcomes; cache mismatch is not success. Saved receipts remain readable without rescanning.

`GET /api/wordpress/businesses/:businessId/media-alt-previews/:proposalId` reads the saved origin/provenance and current saved proposal/execution state without collecting or retrying an action.

General homepage findings are not WordPress media IDs. They cannot bypass the targeted saved WordPress evidence requirement. Offline tests exercise the complete mocked workflow, including disabled writes, changed hashes, restart/replay and public cache mismatch. No production edit or live model call is authorized by policy approval.

## Deferred frontend review panel

The user explicitly deferred the proposed compact panel. Revisit after the backend workflow is settled: expand the existing Fix with AI feedback area with target/current/proposed alt text, expiry/status and Edit, Approve & Apply, Verify controls; establish a local operator browser connection without exposing credentials. Obtain specific UI approval before implementation. [PLAN.md](PLAN.md) and [AGENTS.md](AGENTS.md) retain this follow-up so it is reviewed in future work.

## Dated saved-data validation

The actual Guzman saved Lighthouse inputs (SEO 92, Performance 45, Accessibility 85, Best Practices 96) yield exact Website 79.6, displayed 80. Snapshot `91d67ab5-3f7e-4212-adc9-eb9259450c15` references audit `9961da8a-4575-4f6c-a2e7-53ed72441838`; the saved redirect evidence establishes the tested www page. Social remains unavailable (`UNCONFIRMED_PUBLISHING_GOAL`, `INCOMPLETE_POST_WINDOW`), Consistency requires confirmed business facts, and Overall remains null. These are calculations from existing measurements, not a new scan or a website improvement.

Labeled mock interpretation `c7953af7-0edc-406d-a8c8-3e50a227ec18` was saved and displayed through existing recommendation slots. The actual local browser check passed at desktop and 320/390/768/1280 widths with backend external requests blocked: zero provider attempts, no new audits/edits and byte-unchanged AI ledger files. Mock input/output usage was zero. No real-site edit or live Meta evaluation was performed.

Final checks passed: 44 backend suites, 789 tests and one pre-existing skip; backend/client type checking/build/lint as applicable; Dashboard, Website and Settings browser checks. A fresh read-only SQLite process replayed the stored snapshot exactly (`398/5`, displayed 80) and verified the persisted interpretation remained mocked. Dashboard component class expressions and production CSS remained unchanged.
