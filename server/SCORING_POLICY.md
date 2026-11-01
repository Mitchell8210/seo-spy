# Approved SEO Spy scoring policy v1.4

The user approved the complete [discussion draft](SCORING_POLICY_DRAFT.md) on October 31, 2026. The implementation is `src/scoring/policy.ts` and `calculator.ts`; `GET /api/scoring-policy` exposes the version and SHA256 policy hash. These product rules measure declared observations, not rankings, revenue, compliance or an entire website.

## Current approved amendments (November 1, 2026)

The user requested the six-category Social redesign: Profile Quality 15, Posting Consistency 20, Audience Engagement 25, Audience Reach/Growth 15, Content Quality 15, Customer Interaction 10. New assessments default to `seo-spy-score-v1.4`; historical v1/v1.1/v1.2/v1.3 hashes and replay remain unchanged. See [the complete Social policy, capability audit, thresholds and limitations](SOCIAL_SCORING.md).

Social reports a category breakdown, known/applicable evidence weight, coverage, freshness, missing metrics and deterministic next steps. Definitive Social requires at least 70% applicable coverage, 10 posting points evidenced and 15 engagement points evidenced. Otherwise it is provisional or insufficient data. Only definitive scores populate the numeric Social gauge or contribute to Overall; missing evidence is never zero and Overall weights are never redistributed. Posting uses verified 90-day history; action-density measures use complete 30-day insights/comment evidence and a positive current follower denominator. Lifetime Shares, overlapping views, daily unique follows and new conversations cannot substitute for unavailable period shares, unique reach, aligned growth or response quality. Thresholds are provisional product targets, not industry standards. No paid AI is used.

### Historical v1.3 amendment

The user approved fixing fresh overall investigations and separating reusable business confirmations from individual report IDs. v1.3 preserved v1/v1.1/v1.2 hashes and replay. Its arithmetic and profile readiness were unchanged from v1.2; v1.4 retains its source-review reuse protections while replacing Social scoring.

- Explicit Dashboard Run Investigation refreshes the browser-authorized saved business Facebook Page, then the registered website using mobile Lighthouse, then pins both newly saved report IDs for a final assessment. A failed channel is reported as a failed overall attempt; older reports remain readable but never substitute for fresh evidence in that attempt. Saved reads/polling do not collect, interpret with AI, or retry work.
- A source-agreement review can be reused only when the original business/site/Page match and every compared source claim is unchanged (name, phone, URL, hours, including API omission status). Equality of pass/fail outcomes is insufficient. Changed or missing claims/evidence require review. No preferred name, timezone or unknown Sunday schedule is inferred.
- Reuse stores original report hashes, compared-observation hashes, current report bindings and original confirmation/review dates in the immutable assessment input. It never creates a new human confirmation, updates its date, or rewrites an archive. The original source, confirmation and hours-review clocks must all remain within seven days, and the review's calendar scope remains enforced. Repeated reports cannot renew the review. Current reads suppress expired reuse and comparisons without changing historical snapshots.
- Facebook Always open remains an explicitly dated manual observation when the API omits hours. Fresh matching API omission is not independent confirmation of that schedule.

### Historical v1.2 amendment

The original v1 and intermediate v1.1 remain registered with their original hashes and immutable snapshots. The rules below describing publishing targets and preferred facts are the historical v1 baseline; these approved amendments override them for v1.2 and v1.3:

- Social is Facebook profile readiness only: business name, description/about, website link, contact route and category, each 20%. Posting activity is advisory; no publishing target is required for its numeric score. Missing fields remain unknown unless separately confirmed visibly absent.
- Consistency supports explicitly approved `source-agreement` when no preferred name is known. Compare the two pinned sources directly with name/phone/website/hours weights 20/30/30/20. This measures agreement, not correctness. Do not invent a preferred name, aliases, timezone or Sunday hours.
- Source-agreement confirmations use `seo-spy.confirmed-scoring-facts.v2`, with exact website/Facebook report IDs, confirmed E164 phone/context, actor/time and cited source reviews. Review state `always-open` records the operator observation separately from API hours omission; it uses no invented timezone. An observed restricted schedule disagrees with 24/7 even if Sunday is unspecified. Ordinary schedules still require comparable timezone/date scope. Missing or mismatched evidence blocks the affected score.
- v1.1 separated collection/assessment time from reporting cutoff. Complete activity evidence covers four full UTC weeks ending at the latest completed UTC day. A separately filtered, bounded, exhaustive Page feed query records coverage proof; the recent-post sample and its existing UI fields remain unchanged. v1.2 retains this activity evidence as advisory.
- Overall 50/30/20, Website 50/25/15/10, seven-day freshness, 72-hour source skew, strict completeness and final half-up rounding are unchanged. Reads never call providers or recalculate history.

## Original v1 arithmetic and eligibility

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

## Original v1 confirmed facts and data gaps (historical)

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

## Original v1 saved-data validation (historical)

The actual Guzman saved Lighthouse inputs (SEO 92, Performance 45, Accessibility 85, Best Practices 96) yield exact Website 79.6, displayed 80. Snapshot `91d67ab5-3f7e-4212-adc9-eb9259450c15` references audit `9961da8a-4575-4f6c-a2e7-53ed72441838`; the saved redirect evidence establishes the tested www page. Social remains unavailable (`UNCONFIRMED_PUBLISHING_GOAL`, `INCOMPLETE_POST_WINDOW`), Consistency requires confirmed business facts, and Overall remains null. These are calculations from existing measurements, not a new scan or a website improvement.

Labeled mock interpretation `c7953af7-0edc-406d-a8c8-3e50a227ec18` was saved and displayed through existing recommendation slots. The actual local browser check passed at desktop and 320/390/768/1280 widths with backend external requests blocked: zero provider attempts, no new audits/edits and byte-unchanged AI ledger files. Mock input/output usage was zero. No real-site edit or live Meta evaluation was performed.

Final checks passed: 44 backend suites, 789 tests and one pre-existing skip; backend/client type checking/build/lint as applicable; Dashboard, Website and Settings browser checks. A fresh read-only SQLite process replayed the stored snapshot exactly (`398/5`, displayed 80) and verified the persisted interpretation remained mocked. Dashboard component class expressions and production CSS remained unchanged.

## v1.2 saved-data verification ? November 1, 2026

The user reran the Facebook report through the refreshed browser connection. All five required read permissions were granted. API hours were omitted and the timezone field request returned code 100; neither establishes visible absence. The user separately confirmed that the public Page shows Always open, confirmed +1 725-340-6758, and approved source agreement without a preferred name.

Confirmation 63546772-fcde-4df9-b83e-ec4296eb7a9b pins Website b1dd467e-026a-4b9f-a91f-35f7b10b9504 and Facebook af8dd660-2ef6-4d36-9a68-bb910d5dffed. Assessment f4222edc-0e4f-4fde-8bc7-2a6fe70e4adb yields Website **78**, Social **100**, Consistency **60**, Overall **81**. Names differ; phone and website agree; Facebook Always open disagrees with the website?s Mon?Sat 09:00?18:00, Sunday unknown. Social 100 denotes profile readiness, not posting activity or reach.

A fresh local backend and headless browser displayed all four persisted scores in existing dashboard gauges, passing desktop and 320/390/768/1280 widths. External provider attempts were blocked and remained zero, AI accounting files were byte-unchanged, and no WordPress writes or new audits were made. The configured .env Facebook token had separately failed once with expired-token code 190/subcode 463; it was not retried. The successful report used the refreshed browser connection.

Final v1.2 checks: backend typecheck/lint/build and 46 suites (909 tests passed, one pre-existing skip); frontend lint/build, 11 dashboard mapping tests, opportunity checks and dashboard browser regressions passed. All six persisted assessments replayed exactly across v1, v1.1 and v1.2. The running localhost:3001 Dashboard endpoint also returned 78/100/60/81. Dashboard class expressions and the production CSS hash remained unchanged.
