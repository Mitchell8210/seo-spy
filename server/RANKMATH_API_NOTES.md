# Rank Math evidence adapter

Fresh-execution diagnostics and installed schemas: [audit investigation](RANKMATH_AUDIT_INVESTIGATION.md). Audit result v2 distinguishes success/failed/timeout/unsupported/unknown, with immutable legacy receipts overlaid as unknown on read. The existing metadata/score evidence contract remains unchanged. `analyze-post-content` was independently verified as evidence/test-definition retrieval, not an executed scorer.

`src/integrations/wordpress/rankmath.ts` offers fixed-path helpers for the WordPress connection module. It does not accept an arbitrary plugin route, execute fixes, run shell commands or call paid Content AI tools. Provider responses are untrusted; outputs contain bounded allowlisted fields.

`collectRankMathEvidence(read, {contentType, contentId?, limit?})` reads plugin inventory, discovers exact WordPress ability definitions, and uses the read-only `rank-math/get-post-seo-meta` and `rank-math/get-seo-scores` abilities when available. The explicit definition name and `readonly: true` annotation are required. For a selected Page/Post it falls back to Rank Math meta explicitly registered in core REST. Missing fields remain unavailable rather than becoming an absent description, missing keyword or zero score.

`runRankMathAudit(read)` is a separate operation and must be called only from the connection module's explicitly initiated, authorized and feature-gated audit endpoint. Although Rank Math marks `rank-math/audit-site-seo` read-only and exposes it via GET, fresh analysis can contact Rank Math's remote service and replace cached WordPress audit options. Never call this helper from a GET evidence route, polling or ordinary report viewing. No `fix-site-seo` or Content AI ability is exposed by these helpers.

Scores collected from `get-seo-scores` are stored per-content optimization scores. Their `last_updated` value is a content modification date, not proof of the last scoring time. They are neither Lighthouse measurements nor an SEO Spy overall score. Collection timestamps are recorded separately. The explicit audit helper preserves its provider score, source run date, findings and remote coverage; partial remote failures retain local findings, while no established checks produces unavailable results rather than a clean report.

The metadata ability internally casts an absent score to integer zero. The adapter therefore requires corroboration from the score-list response before publishing a metadata-derived zero; an unscored/null result stays null. A selected content item outside the bounded list may consequently have an unavailable score even when its readable metadata is present. Metadata may use Rank Math templates/fallbacks, so it is not proof of the exact HTML rendered to visitors.

Plugin edition is determined from active Free/Pro plugin identifiers and versions when inventory access succeeds. A Pro add-on does not establish the PRO/Business/Agency account license. Actual ability availability is discovered on each request; a compatible version number alone does not prove a particular ability is enabled or permitted.

## Source references

Live verification on October 30, 2026 confirmed that the installed REST index uses `/wp-abilities/v1/abilities/{name}` and `/wp-abilities/v1/abilities/{name}/run`. The adapter uses these paths; examples that omit `/abilities/` do not match this installation. Ability definitions are read sequentially to respect the shared two-request transport limit. See [module verification](WORDPRESS_MODULE_VERIFICATION.md).

The installed core also requires parsed object query parameters (`input[post_id]=123`, URL encoded). A JSON string in `input` returned HTTP 400 for both metadata and score reads. The adapter now serializes its fixed scalar input fields as structured query parameters, including the explicit audit's `input[refresh]=true`. This matches [core's input extraction](https://developer.wordpress.org/reference/classes/wp_rest_abilities_v1_run_controller/get_input_from_request/), which returns the parsed query value directly rather than decoding JSON.

Inspected October 30, 2026. Current upstream source is a compatibility reference, not a substitute for inspecting the installed site's capability definitions:

- [Rank Math MCP tools](https://rankmath.com/kb/mcp-tools/) documents the named metadata, score and site-audit tools.
- [WordPress Abilities REST API](https://developer.wordpress.org/apis/abilities-api/rest-api-endpoints/) defines discovery and input/query execution formats.
- [Get Post SEO Meta source](https://github.com/rankmath/seo-by-rank-math/blob/master/includes/abilities/post-seo/class-get-post-seo-meta.php), [Get SEO Scores source](https://github.com/rankmath/seo-by-rank-math/blob/master/includes/abilities/content-analysis/class-get-seo-scores.php), and [Audit Site SEO source](https://github.com/rankmath/seo-by-rank-math/blob/master/includes/abilities/seo-analysis/class-audit-site-seo.php) define the allowlisted contracts used by the adapter.
- [SEO analyzer source](https://github.com/rankmath/seo-by-rank-math/blob/master/includes/modules/seo-analysis/class-seo-analyzer.php) shows audit cache updates and remote analysis requests.

Offline fixtures cover zero/null, plugin edition, missing permissions, absent registered meta, schema changes, incorrect content IDs, invalid scores, bounded samples, safe text, explicit audit triggering and partial/empty audit outcomes. No live content changes or audit scans are performed by the test suite.
