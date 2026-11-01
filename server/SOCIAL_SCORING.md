# Social presence scoring — policy v1.4

Implemented November 1, 2026 following the user's six-category redesign. This is a deterministic, evidence-based review of observable Facebook presence and activity. It does not claim to prove revenue, customer satisfaction, content accuracy or unique-person engagement. No AI inference is used.

## Capability audit

The current Guzman connection uses Graph v26.0. Its saved permissions include `pages_show_list`, `pages_read_engagement`, `read_insights`, `pages_read_user_content`, and `business_management`. Additional management permissions are not evidence that every Insights metric or Messenger resource is available. Credentials remain server-only.

November 1 saved report `8d6ae8b9-23c9-4867-bccc-248133050615` establishes the following observations. These are dated capability results, not guarantees that Meta will continue returning these metrics.

| Evidence | Observed availability | Scoring use |
| --- | --- | --- |
| Five populated profile fields, current followers | Available; 17 current followers | Profile checks; current audience denominator |
| LIKE breakdown of `page_actions_post_reactions_total` | Four LIKE actions across complete 30 daily buckets | LIKE-only action density; no invented other reactions |
| Timestamped comments/replies | One across complete accessible post/comment coverage | Comment action density, including activity on older posts; author identity is not established |
| `page_media_view` | 115 across complete 30 daily buckets | Non-unique visibility per current follower; not unique reach |
| Daily follows/unfollows; `page_follows` snapshots | Returned, but no independently verified snapshot at both exact window boundaries | Retained as source data; exact 30-day follower growth unavailable |
| Lifetime shares | Known lower bound 243, truncated/omitted fields | Not used for 30-day engagement |
| Shared-post edges | Empty even for posts with known lifetime shares | Cannot prove zero or complete timestamped shares |
| New conversations | One | Not messages, response rate, response time or response quality |
| Messenger conversation metadata | Provider rejected the tested access | Customer response criteria unavailable |
| Recent post sample / legacy publishing proof | 50-post sample truncated; complete proof covers 28 days | Neither establishes a 90-day scoring window |

New explicit reports additionally request `/{pageId}/posts` with `id,message,created_time` for **90 completed UTC days** ending at collection-day midnight. This uses the existing authorized Page token, bounded pagination and shared collection deadline. Completeness is established only if the edge is exhausted without ownership/date/duplicate/paging errors. Limits are ten pages, 250 posts and 2 MiB retained message text. Text beyond the cap is explicitly unretained; posting timestamps may remain usable while content scoring stays unknown. The legacy 28-day proof and 50-post sample remain unchanged.

This implementation attempted the official [Page Insights reference](https://developers.facebook.com/docs/graph-api/reference/page/insights/), [Pages posts guide](https://developers.facebook.com/docs/pages-api/posts/) and [permissions reference](https://developers.facebook.com/docs/permissions/). Retrieval returned rate-limit/access errors. No claim of additional supported metrics or deprecation status is based on inaccessible documentation. The implementation uses existing live-verified metrics only when each new response passes exact name/period/window/value validation. Provider rejection, empty arrays or incomplete buckets stay unavailable. No speculative Insights calls or new permissions were added.

## Weights and calculation

| Category | Maximum points | Criteria weights |
| --- | ---: | --- |
| Profile Quality | 15 | Name 3; description signals 3; website syntax 3; contact syntax 3; category 3 |
| Posting Consistency | 20 | Frequency 6; recency 5; active weeks 5; longest inactivity 4 |
| Audience Engagement | 25 | LIKE actions per audience 10; comment actions per audience 10; period shares per audience 5 |
| Audience Reach and Growth | 15 | Aligned follower growth 10; media visibility per audience 5 |
| Content Quality | 15 | Structural actionability 4; structure variety 3; avoiding exact repetition 4; supported relevance review 4 |
| Customer Interaction | 10 | Verified response coverage 5; verified response time 5 |

Each adequately evidenced criterion earns its weight multiplied by its threshold percentage. Unknown criteria earn **no assigned value**, not zero. Category points show the sum of known earned points alongside the full category maximum and separately evidenced weight. A category with no known criteria is unavailable.

`normalized Social score = 100 × sum(known earned points) / sum(known applicable criterion weights)`

`coverage = 100 × known applicable criterion weight / all applicable criterion weight`

The score uses exact rational weighted arithmetic and final half-up integer rounding. Ratios are calculated from validated finite measurements; no arbitrary penalties or ceilings are added. An actual zero remains zero. Inaccessible evidence never becomes a poor-performance result, and unavailability never establishes non-applicability. The current adapter excludes no criterion as non-applicable; the reusable engine requires separate cited applicability evidence before any future exclusion.

**Definitive:** at least 70% applicable weight is evidenced, including at least 10 of 20 posting points and 15 of 25 engagement points. These are evidence-weight requirements, not minimum performance scores. **Provisional:** some non-profile performance is evidenced, but one of those gates is unmet. **Insufficient data:** only profile evidence or no adequate evidence is available. Profile-only coverage is at most 15%, and never yields a definitive numeric score. A provisional number is shown only in the labeled breakdown. Only definitive Social scores can populate the main Social gauge or contribute to Total Spy Score; missing components are not reweighted in Total Spy Score.

Because normalization is evidence-based, a provisional score can be high while coverage is low. It must always be read together with coverage and missing metrics. Even a definitive 100 means all **measured** criteria met the configured targets; it does not mean every possible aspect of social presence was measured or perfected. No artificial ceiling disguises missing evidence.

## Initial configurable thresholds

These are **provisional SEO Spy product targets**, not established industry standards, Meta recommendations or validated cross-industry benchmarks. They should be calibrated against future representative business evidence without rewriting old policies. Configuration lives in `src/scoring/social-performance.policy.ts`; its frozen thresholds/hash are included in score policy v1.4. The standalone engine accepts an explicitly supplied validated policy, but published v1.4 snapshots always use this exact registered policy.

For increasing criteria, the four listed thresholds earn 25%, 50%, 75%, 100% of that criterion's points respectively; below the first threshold earns zero. For decreasing criteria, the four ceilings earn 100%, 75%, 50%, 25%; above the last ceiling earns zero.

| Criterion | Thresholds or rule |
| --- | --- |
| Name and category | Verified populated value = 100%; unknown/omitted value remains unknown. No semantic correctness inferred. |
| Description | Populated description/about = 50%; populated plus an observable service/resource/next-step cue = 100%. Cues are limited English/Spanish text patterns; they do not prove usefulness or quality. |
| Website | Verified valid HTTP(S) syntax without embedded credentials = 100%; a returned malformed non-empty URL = zero. No destination/ownership/availability inferred. |
| Contact | Syntactically valid phone (7–15 digits) or email = 100%. Unknown alternative contact fields prevent an unsupported absence/zero finding. |
| Posting frequency | 0.25 / 0.5 / 1 / 2 posts per week, averaged across all 90 days |
| Posting recency | Latest post within 7 / 14 / 30 / 60 days; complete zero-post history has 90-day inactivity |
| Active week ratio | 25% / 50% / 75% / 100% of the twelve consecutive seven-day blocks ending at cutoff (84 days inside the 90-day window) |
| Longest inactive interval | At most 7 / 14 / 30 / 60 days, including both 90-day window edges |
| LIKE actions per 100 current followers | 0.5 / 1 / 3 / 5 over 30 completed Pacific days |
| Comments/replies per 100 current followers | 0.25 / 0.5 / 1 / 2 over the same 30 days |
| Timestamped period shares per 100 current followers | 0.1 / 0.25 / 0.5 / 1; currently unavailable, never populated with lifetime shares |
| Follower growth | 1% / 3% / 5% / 10% from verified, aligned 30-day start/end snapshots; currently unavailable |
| Media views per current follower | 0.5 / 1 / 3 / 5 over 30 completed Pacific days |
| Structurally actionable post ratio | 25% / 50% / 75% / 100% of fully observed text posts with a resource link, question, contact/next step or explanatory structure |
| Observable structure variety | 1 / 2 / 3 / 4 distinct structures (resource, question, contact/next step, explanatory list/how-to) |
| Distinct post ratio | 25% / 50% / 75% / 100% distinct normalized text across the complete text sample |
| Supported usefulness/relevance review | 25% / 50% / 75% / 100% explicitly supported reviewed ratio; currently unavailable |
| Customer response coverage | 25% / 50% / 75% / 100% of verified eligible inquiries with a verified business response; currently unavailable |
| Median response time | At most 1 / 4 / 12 / 24 hours from actual paired inquiry/response timestamps; currently unavailable |

Posting uses the complete owned 90-day evidence, not assumptions about ordering or a truncated sample. The observed period is not adjusted for unverified Page age. No posts in a complete window is a verified posting zero; it does not establish that nonexistent content is poor. Content proxies require a complete non-empty text sample; omitted, media-only or unretained text makes those proxies unavailable. Repetition checks normalize Unicode, case and whitespace and detect exact repetition only; substantive similarity and visual quality remain outside this model.

The engagement ratios are **action density using the current audience as a denominator**, not unique-person engagement rates or per-post rates. Likes exclude other reaction types; comments can include business replies. Repeat actions, non-followers and paid distribution may contribute. Small follower counts create volatile ratios, so counts and denominators are included in criterion explanations. Zero followers makes these rates undefined/unavailable rather than awarding or deducting points. Media views are used once, without adding overlapping Page/video view totals.

## Integrity, persistence and UI

`assessment-social-performance.ts` validates exact business/site/Page/report ownership, actual citations and profile value equality; re-aggregates exactly thirty daily buckets against DST-aware boundaries; requires hash-bound complete comment/history evidence; and refuses incompatible counts, dates, periods and denominators. Complete 90-day history is separately hash-bound to its evidence. The reusable engine validates freshness, cited report ownership and criterion availability. The original seven-day evidence limit remains; expiry uses the earliest dependency timestamp, and current reads suppress expired eligibility without rewriting historical calculations or starting work.

New assessments default to `seo-spy-score-v1.4`. Versions v1/v1.1/v1.2/v1.3 retain their objects, hashes and replay behavior. Consistency source-review reuse and original review expiry remain unchanged. Old reports are not upgraded to invented 90-day coverage. A new explicit report must actually collect the new history.

The requested Dashboard Social breakdown shows status/value, all six category maxima/known points, coverage, collection/assessment/expiry timestamps, criterion explanations/citations, missing metrics and category next steps. Explanations and next steps are expandable within the existing Social card. Other cards, navigation, controls and scoring formulas are preserved. Website and Social Media pages continue accepting only eligible saved channel scores; provisional values are never passed off as definitive.

Future adapters can supply complete period shares, aligned follower snapshots, supported content review, and paired customer inquiry/response measurements through explicit criterion contracts. Adding a value requires its actual availability, target ownership, period, complete coverage, timestamps and citations; the existence of an extension point is not permission to fill it with a proxy or mock production result. Changing thresholds or evidence semantics requires a new published policy/version.

No paid Meta AI inference, prompt generation or external write is involved in collection, scoring, tests or report reads. Mock-first settings and the protected budget ledger remain intact. Provider reads run only from explicit report actions; page load, rendering, startup and polling never collect or generate analysis.

## Guzman live verification — November 1, 2026

The authenticated overall run saved Facebook report `3aeafc4c-34f5-4caa-82ed-0a8dd6b9857b` and Website report `43a66038-2184-4f72-b242-8381102b651d`, then final assessment `a0c19a0e-2be3-447e-a795-e7fdee84c0bf`. Both channels were freshly collected. The 90-day post edge was exhausted with three timestamped posts and fully retained text; no duplicates, out-of-window records or missing timestamps. This is actual saved provider evidence, not a mock fixture.

| Category | Known earned points | Maximum | Evidenced weight |
| --- | ---: | ---: | ---: |
| Profile Quality | 15 | 15 | 15 |
| Posting Consistency | 0 | 20 | 20 |
| Audience Engagement | 20 | 25 | 20 |
| Audience Reach and Growth | 5 | 15 | 5 |
| Content Quality | 10.25 | 15 | 11 |
| Customer Interaction | Unavailable | 10 | 0 |

Known earned points are 50.25 across 71 evidenced points: `50.25 / 71 × 100 = 70.7746…`, displayed **71/100**, with **71% coverage** and definitive eligibility under the declared minimums. Posting earns zero because three posts over 90 days is 0.233 posts/week, only one of twelve complete weeks is active, and the most recent post/longest inactivity is about 73 days. Missing period shares, aligned growth, supported relevance review and paired customer-response measures remain unknown, not zero.

The final dashboard showed Website **80**, Social **71**, Consistency **60**, Total Spy **73**. Native desktop browser inspection confirmed the completed workflow, new source timestamps, score gauges and category breakdown. The workflow is partial because some provider fields are unavailable; numeric eligibility separately passes its explicit evidence requirements. Frontend tests cover provisional/insufficient/stale rendering and citation/ownership guards.

Final checks passed: 59 backend suites, 1085 tests and one pre-existing skip; backend typecheck/lint/build; frontend lint/build and 33 mapping/workflow/render tests. Five selected old/new saved assessments replayed successfully. Local deterministic recalculation and interrupted-run recovery verified unchanged source archives/protected AI ledger where applicable. No paid AI or WordPress writes were made.

During the user's startup check, the ignored local development budget setting failed schema validation. Corrected only that setting to zero, preserving all other local configuration and the persistent ledger. An audit interrupted by a development restart was closed through the existing explicit recovery procedure after verifying its original worker was gone; its partial facts/history were preserved and no provider work was replayed. The subsequent fresh run completed normally and API health returned OK.


## Dashboard presentation follow-up ? November 1, 2026

The user requested removal of the new Social scoring breakdown from the Dashboard. The section and its component were removed. Scoring, evidence coverage, category ledgers and definitive-only gauge eligibility remain in the data/backend layer. Preserve the existing dashboard gauges and presentation; do not reintroduce calculation details without explicit approval.
