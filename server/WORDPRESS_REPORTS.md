# Saved WordPress evidence and Muse interpretation

Implemented October 31, 2026 for the existing authenticated local operator. The frontend is unchanged. These endpoints extend the WordPress module; existing audit/download contracts are unchanged. All paths below are relative to `/api/wordpress/businesses/:businessId` and require the private operator Bearer token, local Host and exact trusted Origin checks.

| Method/path | Behavior |
| --- | --- |
| POST `reports` | Explicit read-only WordPress collection. Optional `{ "sampleSize": 20 }`, integer 1–20. Returns 201 only after publishing the immutable report. |
| GET `reports?limit=20` | Newest saved summaries for this exact registered business/site. Limit 1–50. No provider calls. |
| GET `reports/:reportId` | Saved JSON report/download. No collection. |
| GET `reports/:reportId/muse-evidence` | Prepare bounded, minimized model input with stable citations. No model call. |
| POST `reports/:reportId/muse-analyses` | `{ "confirmed": true }` explicitly requests one potentially paid interpretation. Independent AI gates apply. No WordPress calls, audit or write. |
| GET `reports/:reportId/muse-analyses/:analysisId` | Saved validated interpretation. No model call, even with AI disabled or its key removed. |
| POST `proposals/:id/verifications` | `{ "pageResource": "pages", "pageId": 123 }` collects public source HTML for an applied media-alt-only proposal and saves a separate receipt. Posts are also supported. No caller URL. |
| GET `proposals/:id/verifications/:verificationId` | Saved public verification receipt without collection. |

## Evidence and coverage

`seo-spy.wordpress-evidence.v1` has a server UUID, business/site binding, collection start/completion dates, sample size, availability, three content sections (pages/posts/media), two Rank Math sections (pages/posts), null scoring and limitations. Per-source timestamps and item IDs preserve provenance. Content includes only ID, title, link, modification time and media alt text. HTML bodies, credentials, operator identity and unrelated metadata are excluded. Titles and all collected strings are untrusted text.

Collection requests the first bounded page of published, non-password-protected pages/posts. Visibility must be established; unsupported/invalid responses remain unavailable. Media is restricted to attachments whose associated `post` belongs to those published samples. Unattached images, images attached to other content and widget-specific alternatives may be omitted. WordPress's media collection filter is named `parent`, but its response field is `post`; see the [official media contract](https://developer.wordpress.org/rest-api/reference/media/).

New reports carry `collectionPolicyVersion: published-unprotected-v1`. Legacy snapshots without that visibility-policy marker remain readable without archive mutation, but Muse packaging rejects them; collect a new report before sending evidence to the model.

Rank Math metadata is requested for one sampled published record per resource; the stored-score list is independently bounded to 20 and filtered to this report's published IDs. This is not a representative sitewide average. Null and explicit zero stay distinct. Score calculation dates/freshness are unknown; modification dates do not establish them. Existing Rank Math discovery may describe the audit ability, but report collection never executes it. Source reads are sequential; they do not constitute an atomic site snapshot.

Sources that fail remain explicit unavailable sections in a saved partial/unavailable report. Empty data is never a clean-audit finding. Older reports remain readable after later collection failures. Overall availability describes collection, not SEO quality or a numeric score. SEO Spy score and scoring policy remain null; no scoring formula has been approved.

## Persistence and operation

`WORDPRESS_REPORTS_DIR` defaults to `reports/wordpress-evidence`; `WORDPRESS_MUSE_DIR` defaults to `reports/wordpress-muse`. Relative paths resolve from the backend package. Evidence and analysis use separate, validated, size-bounded immutable JSON files, published through synced temporary files and non-overwriting hard links. Archive paths/files reject unsafe links and corrupt records. History scanning is sequential and O(archive count); only the requested newest results are retained in memory. Protect these local directories from untrusted writers.

Collection and analysis requests run synchronously. In-process guards reject concurrent duplicate collection/analysis; they are not durable jobs or replay keys. Interrupted collection may leave no terminal report. A lost response may leave a successfully saved report; inspect history before requesting collection again. There is no automatic retry. A sequentially repeated analysis POST is a new spending request, not an idempotent replay. Failed/invalid model attempts consume the process call cap but do not create successful analysis records; restart-safe attempt/spend accounting remains future work.

Saved reads validate the registered business and exact configured site without requiring live WordPress credentials or connections. Changing the binding does not expose an old installation's history. Missing/mismatched report/analysis IDs return 404. Malformed requests return 400, concurrent requests 409 and storage failures 503. Fixed application-authored AI/storage failure codes may be returned in the standard error envelope; raw provider messages remain private.

## Muse boundaries

The prepared `seo-spy.wordpress-muse-evidence.v1` bundle contains the source hash, stable report/resource/content citations, collection dates, bounded excerpts, omission/truncation counts, coverage and an informational capability catalog. It grants no permission. The model cannot choose URLs, execute tools, create patches/proposals, approve a change or trigger Apply.

Analysis uses a fixed versioned instruction, strict output schema and independent citation/target/capability validation. `seo-spy.wordpress-muse-analysis.v1` records link source report/hash, model, prompt/output versions, usage, safe request ID and dates. Recommendations include effort, risk, conditional verification and manual fallback; unsupported Rank Math/Elementor editing remains manual. Reference checks cannot establish the truth of every natural-language claim. Human quality review and a separately authorized live evaluation remain necessary. This slice interprets WordPress evidence only; combined Website/Facebook assessments, numerical scoring and frontend integration remain separate.

See [provider configuration](MUSE_PROVIDER.md). Defaults are AI off, model/key blank and call cap zero. Do not paste keys into chat, source, reports or browser variables. Configure a private key only in ignored server configuration after choosing the model, processing terms and live-test budget. Per-process call/token limits are not a restart-safe dollar budget.

## Public image verification

The server requires an applied media-alt-only proposal on the same installation. It obtains the published page URL and media source from bound WordPress IDs. The shared protected collector enforces HTTPS/site binding before each DNS resolution, including redirects, and retains its public-address checks, connection pinning and resource limits. Audit collection and verification share one collector instance and its concurrency bound.

Verification parses inert source HTML, matches actual image sources and supported WordPress image variants, and distinguishes `verified`, `mismatch`, `inconclusive`. Attachment classes alone or contradictory responsive/widget sources cannot establish identity. Missing alt and empty alt are distinct. Stored-field agreement is a separate boolean. Receipts contain bounded observed alternatives and dates, never the HTML or operator identity in API responses. No cache purge, JavaScript execution, automatic follow-up, ranking or performance improvement is implied. A later explicitly requested check creates a new receipt rather than rewriting the old one.

## Verification

Run `npm run check` from `server/` for offline tests, typecheck, lint and build. After building, `node scripts/verify-wordpress-reports.mjs` is an explicit live read-only collection check: writes and AI are forced off; saved JSON is compared to the POST response and history. It makes no fresh audit or content update. The [media pilot workflow](WORDPRESS_STAGING.md) requires approval of an exact proposal before any Apply.

First live report: `5cdc1239-4a07-4546-a940-af0b0cca81f6`, generated `2026-10-31T17:57:51.118Z` for the bound Guzman business. Saved/read/history checks passed; page/post counts 20/17 and filtered stored-score counts 13/17. Media was unavailable in that first snapshot because the adapter originally requested `parent` instead of the attachment response field `post`; that mapping is corrected for subsequent collection. The historical snapshot is preserved. No fresh audit or AI call occurred.

Corrected live collection: `028092a7-bc06-4a37-92d0-02d333411322`, generated `2026-10-31T18:11:28.361Z`. All five source sections were available: 20 pages, 17 posts, 20 associated media, and filtered page/post stored-score counts 13/17. Saved read/history checks passed with writes disabled and no AI/fresh audit. This second snapshot preceded the policy marker; the same legacy Muse guard applies.

Final live verification: `12897672-5152-4f1c-b727-b72cd3cdfe9c`, generated `2026-10-31T18:14:22.516Z`, includes the current visibility-policy marker. All five sections were available with the same 20/17/20 content and 13/17 stored-score counts. Saved JSON/history matched; Muse preparation produced 91 cited observations without a model call. Writes stayed disabled. `npm run check` passed all 24 suites, 429 tests with one skipped, plus typecheck/lint/build. The frontend was untouched by this work. No content edit, fresh audit or paid model call occurred.
