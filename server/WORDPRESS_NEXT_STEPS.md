# WordPress module: next steps

Status: phases 1 and 2 verification completed October 30–31, 2026 UTC. One separately authorized fresh-audit request returned unavailable evidence; receipt/replay checks passed and writes are disabled. This checklist does not authorize additional live changes or fresh audits. See [module verification](WORDPRESS_MODULE_VERIFICATION.md) for dated outcomes and limitations.

Implementation reference: [WordPress module](WORDPRESS_MODULE.md). Broader roadmap: [Meta Muse integration plan](AI_AGENT_INTEGRATION_PLAN.md).

## Where we are - October 31, 2026

- **Steps 1 and 2: complete with limitations.** Content, metadata and stored Rank Math scores are readable. Fresh sitewide audit execution remains unverified; its previous outcome is unknown. Diagnostics and explicit execution states are now implemented.
- **Saved evidence: implemented and live-checked.** Immutable business/site-scoped reports, saved reads/history and minimized Muse bundles are available. See [report contracts and results](WORDPRESS_REPORTS.md).
- **Scoring decision:** stored Rank Math scores will have a small supporting weight. The exact cap and aggregation remain undecided; no SEO Spy scoring formula is implemented.
- **Traffic discovery: complete.** Site Kit reports require Google authorization that our current user does not have; Rank Math traffic summaries return `n/a`. The user excluded Google authorization setup. No traffic integration or authorization work is planned.
- **Edit pilot: previewed, not applied.** The user selected the existing Guzman live website rather than separate staging. Media 5522's exact alt-only proposal was prepared, but expired at `2026-10-31T18:12:33.201Z` without approval. A fresh preview/hash/review is required before Apply; staging isolation is not established. See [pilot workflow](WORDPRESS_STAGING.md). Writes remain disabled.
- **Public verification: implemented.** Applied media-alt-only proposals can collect bound public HTML and save separate verified/mismatch/inconclusive receipts. Fixtures cover caches, overrides and failures; live outcome remains to be recorded.
- **Muse: mock-first implementation and credit controls complete.** The user configured a private key and selected Spark 1.3 Standard/low reasoning. Labeled mocks, durable caching, exact administrator approvals and SQLite reservations enforce $2 lifetime/$0.50 UTC-daily/ten-call development ceilings. Local mock API verification passed with zero external requests/charges. No individual real call is approved; live acceptance and numerical scoring remain unverified. See [usage rules](AI_USAGE_RULES.md).
- **Steps 5 and 6: future work.** Specialized Rank Math/Elementor editors and application-user authorization/UI approval controls remain unimplemented. Local operator testing does not establish shared/public readiness.
- **Fresh audit follow-up: deferred.** No retry is planned without new explicit authorization. It does not block use of existing evidence.

## 1. Configure and verify the module's read access

- [x] Confirm the registered business ID and website match the intended Guzman WordPress installation.
- [x] Configure `WORDPRESS_BUSINESS_ID`, `WORDPRESS_SITE_URL` and a private `WORDPRESS_OPERATOR_KEY` in the ignored backend `.env`. Reuse the existing username/application password without displaying or copying them into reports.
- [x] Keep `WORDPRESS_WRITES_ENABLED=false`.
- [x] Start a fresh compiled backend on a temporary loopback port and verify the module's connection endpoint using operator authorization. Existing development processes were not interrupted.
- [x] Read page, post and media lists through the new module endpoints, then retrieve representative individual records.
- [x] Confirm account capabilities, modification timestamps and original editable values are available.
- [x] Verify invalid operator credentials and a different business ID are rejected.
- [x] Save a credential-free verification summary with the date, tested endpoints, outcomes and limitations.

**Checkpoint:** read access works through the new module, not just the earlier standalone diagnostic. At the phase 1 checkpoint, no write or fresh-audit requests had been made.

## 2. Verify Rank Math evidence on the actual site

- [x] Read the installed Rank Math version/edition through the module and discover the abilities actually available to this account.
- [x] Retrieve exposed SEO metadata for a representative page and post.
- [x] Retrieve the bounded stored-score sample; preserve unavailable values and distinguish stored scores from fresh measurements.
- [x] Record missing fields, permission failures, unsupported abilities and source-date limitations.
- [x] Obtain explicit authorization for one fresh Rank Math site audit. Explain that the operation can contact Rank Math and update its cached analysis despite using a vendor GET endpoint.
- [x] Temporarily enable the required gate for that authorized operation, submit one confirmed request with a unique request ID, and inspect its result. The returned evidence was unavailable; a completed remote scan was not established.
- [x] Retrieve the saved receipt through GET without triggering another audit. Verify the request ID cannot accidentally cause a duplicate run.
- [x] Restore writes/audit triggers to disabled and record the audit's findings, coverage and limitations.
- [x] Investigate the unavailable result without another sitewide audit; preserve the historical outcome as unknown. A deadline mismatch is suspected, not proven.
- [x] Add redacted execution diagnostics and API states: `success`, `failed`, `timeout`, `unsupported`, `unknown`.
- [x] Test `analyze-post-content` on one existing page: evidence and 22 test IDs retrieved successfully; the tool does not execute scoring.
- [x] Check additional traffic sources; document inaccessible Site Kit reports and unavailable Rank Math traffic summaries. Exclude Google authorization setup from further work.

**Checkpoint:** document which Rank Math evidence is genuinely available on this installation. Do not substitute its scores for Lighthouse or SEO Spy scores.

Details: [audit investigation](RANKMATH_AUDIT_INVESTIGATION.md) and [traffic-data discovery](WORDPRESS_ANALYTICS_DISCOVERY.md).

## 3. Exercise one approved edit on staging

October 31 update: the user chose the existing Guzman site for a narrow live media-alt pilot. The [CLI](WORDPRESS_STAGING.md), exact proposal review and stored/public verification are implemented. A distinct staging installation has not been identified. The pilot is not complete until exact approval, execution and receipts are obtained.

- [ ] Identify a staging/test WordPress installation and bind its credentials to the correct registered business. Do not redirect production credentials to an unrelated target.
- [ ] Choose one reversible update, preferably alt text for a confirmed informative image. Empty alternatives may be intentional for decorative images.
- [ ] Capture the target ID, original value, modification timestamp and where the image appears.
- [ ] Create a proposal and review its exact target, before/after values, hash and expiry.
- [ ] Obtain explicit authorization for that exact staging change; enable writes only for the approved test.
- [ ] Apply the proposal once and inspect the execution receipt and stored-field verification.
- [ ] Verify duplicate Apply requests do not repeat the write, and a stale target requires a new proposal.
- [ ] Confirm the existing recovery procedure for uncertain outcomes and retained locks; never automatically retry an uncertain write.
- [ ] Restore the original value only through a separately approved proposal if needed, then disable writes again.

**Checkpoint:** one staging operation has a complete proposal, approval, execution and verification trail. No production edit is implied by this test.

## 4. Add public rendered-page verification

- [x] Define field-specific public checks separate from stored fields (media alt text only).
- [x] Reuse the protected collector and registered target binding; no unrestricted browser/fetch fallback.
- [x] Handle caches, propagation delays and builder overrides as mismatch/inconclusive. Other SEO-plugin fields remain unsupported.
- [ ] Verify that an attachment alt-text update reaches the actual rendered image where expected; existing markup or Elementor widgets may store a different value.
- [x] Keep applied, verified, mismatch and inconclusive outcomes distinct; no ranking/performance claim.
- [x] Cover stale caches, overridden fields, delayed results and failed collection with fixtures.

**Checkpoint:** the application can establish whether the approved change is visible on the intended public page, or truthfully report why verification is inconclusive.

## 5. Build specialized editing adapters

### Rank Math SEO fields

- [ ] Verify supported authenticated write routes and exact field schemas for the installed version.
- [ ] Implement narrowly scoped SEO-title and meta-description proposals, with readable before/after values and independent verification.
- [ ] Handle templates/fallbacks and distinguish the WordPress Page title, excerpt and rendered SEO metadata.
- [ ] Preserve approval binding, resource locks, uncertain-outcome handling and default-off writes.
- [ ] Test compatibility failures and unavailable fields before an explicitly approved staging write.

### Elementor content

- [ ] Investigate the installed Elementor version and structured document format.
- [ ] Select one supported widget/field update rather than replacing an entire page body or builder document.
- [ ] Preserve unrelated layout, styles, widgets and settings; include exact structured diffs and conflict checks.
- [ ] Add fixture tests and separately approved staging tests before enabling the adapter.

**Checkpoint:** enable each adapter independently only after its capabilities and verification behavior are proven. Unsupported changes remain manual recommendations.

## 6. Add application-user approval controls

- [ ] Implement application identity, business membership and asset-level authorization before shared/public execution. The current operator token is a local development mechanism.
- [ ] Inspect existing frontend controls and propose the exact target/diff/confirmation/status presentation needed.
- [ ] Obtain approval for any presentation changes under the frontend preservation rule before implementing them.
- [ ] Connect approved controls to proposal review, explicit user-initiated Apply and execution receipts.
- [ ] Show failures and uncertain outcomes without offering unsafe automatic retries.
- [ ] Test ownership rejection, edited/expired proposals, duplicate clicks, navigation and responsive layout.

**Checkpoint:** a real authenticated user can initiate only the exact reviewed action for an authorized business asset. Viewing a recommendation or generating a report never applies a fix.

## 7. Connect WordPress evidence to Meta Muse

- [x] Persist read-only evidence as versioned business-scoped reports with dates, IDs, coverage, unknown freshness and nulls.
- [x] Package WordPress/Rank Math observations with asset IDs, dates, coverage and provenance.
- [x] Exclude credentials/private content; treat collected text as untrusted data.
- [x] Supply the actual informational action catalog, including manual-only capabilities; it grants no permission.
- [x] Require cited recommendations, effort/risk and verification steps through strict validation. Live quality review remains pending.
- [ ] Validate all references and proposed arguments before creating an executable proposal.
- [x] Keep scores unavailable until a reviewed backend policy exists; no formula or silent blend is implemented.
- [ ] Use stored Rank Math scores only as a low-weight supporting signal under the [accepted scoring direction](AI_AGENT_INTEGRATION_PLAN.md#accepted-direction-stored-rank-math-evidence). Approve the exact contribution cap and aggregation later; preserve unknown freshness/nulls and avoid duplicate deductions.
- [x] Evaluate WordPress-only interpretation with controlled reports and mocked providers. There are no model execution tools.
- [x] Select Spark 1.3 Standard/low reasoning, configure the key privately, and implement mock-first persistent cost/approval protections with offline tests.
- [ ] If essential functionality cannot be validated with mocks, review one exact maximum-cost estimate and obtain separate administrator approval before a real call. Preserve credits; no bulk live evaluation or repeated prompt tuning.

**Checkpoint:** Muse can explain WordPress/Rank Math evidence and propose supported fixes, while the backend independently enforces explicit user initiation, authorization and verification.

## Verification and handoff for each implementation phase

- [ ] Run targeted tests for the changed behavior and `npm run check` from `server/` for backend implementation changes.
- [ ] Run relevant client lint/build/browser checks if frontend integration is authorized and affected.
- [ ] Keep normal tests offline. Live audits and staging writes require explicit authorization and a clearly bounded target.
- [ ] Update module documentation with actual capabilities, results and remaining limitations.
- [ ] Review the diff for credentials, unintended changes and unapproved frontend presentation changes.
- [ ] Leave writes disabled after verification unless the user explicitly requests otherwise.

Documentation-only updates do not require the application test suites. Do not claim any live validation or implementation task is complete until it has actually been performed.
