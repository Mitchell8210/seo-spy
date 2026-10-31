# WordPress connection and Rank Math evidence module

Backend implementation for local operator use. No frontend changes or live content edits were performed. Subsequent phase 2 verification dispatched one explicitly authorized fresh Rank Math audit request; the returned evidence was unavailable, while receipt/replay checks passed and writes were disabled afterward. See [module verification](WORDPRESS_MODULE_VERIFICATION.md). The existing Guzman application password is reused through server configuration; no credential is returned by these APIs.

## Setup

Keep existing `WORDPRESS_USERNAME` and `WORDPRESS_APPLICATION_PASSWORD` in ignored `server/.env`. Configure the binding and an independent private operator token:

```dotenv
WORDPRESS_BUSINESS_ID=demo-guzman
WORDPRESS_SITE_URL=https://guzmantaxaccounting.com
WORDPRESS_OPERATOR_KEY=<private-random-token-of-at-least-32-characters>
WORDPRESS_WRITES_ENABLED=false
WORDPRESS_ACTIONS_DIR=reports/wordpress-actions
WORDPRESS_REPORTS_DIR=reports/wordpress-evidence
WORDPRESS_MUSE_DIR=reports/wordpress-muse
WORDPRESS_FRONTEND_ORIGIN=http://localhost:5173
```

The site hostname must match the registered business website (www/non-www aliases are accepted). HTTPS root origins only; private addresses, credentials in URLs, redirects and custom ports are rejected. DNS answers are validated and the actual connection is pinned/checked. Responses, request bodies, headers, duration and concurrency are bounded. There are no automatic network or write retries.

Use `Authorization: Bearer <WORDPRESS_OPERATOR_KEY>` for every module endpoint. This token represents the trusted local operator, separate from WordPress's application password. Local Host checks and exact Origin checks apply; CLI requests can omit Origin. Swagger's authorization input uses the operator token, not the WordPress password. Do not expose these local endpoints publicly: this is not application-user authentication or multi-tenant credential onboarding.

Real user sign-in, per-business membership and approval actors must replace/extend this local operator model before shared/public operation. Do not expose the token to an AI model or treat it as a production browser credential.

## Routes

All routes below are relative to `/api/wordpress/businesses/:businessId` and require operator authorization.

| Method/path | Behavior |
| --- | --- |
| GET `connection` | Verify current account and selected capabilities; expose no credentials |
| GET `content/:resource?page=1&perPage=20` | Bounded list of pages, posts or media; maximum 50 per request |
| GET `content/:resource/:id` | Selected editable fields and modification timestamp; HTML is untrusted text |
| GET `rank-math/evidence?resource=pages&id=123` | Versioned Rank Math plugin information, ability availability, selected SEO metadata and bounded stored score sample; `id` optional; `posts` also supported |
| POST `proposals` | Read current before-values and create an expiring exact patch proposal; no remote mutation |
| GET `proposals/:id` | Original proposal, execution-start marker and saved outcome |
| POST `proposals/:id/apply` | Explicitly approve the exact hash and execute once, only with writes enabled |
| POST `rank-math/audits` | Explicit audit request with unique request ID, confirmation and writes enabled |
| GET `rank-math/audits/:requestId` | Read the saved audit receipt without another scan, even with writes disabled |
| POST `reports` | Collect bounded published evidence and publish an immutable local report; no fresh audit |
| GET `reports` and `reports/:reportId` | Saved history/JSON reads; no WordPress calls |
| GET `reports/:reportId/muse-evidence` | Minimized cited evidence bundle; no model call |
| POST `reports/:reportId/muse-analyses` | Confirmed read-only interpretation; independent default-off AI gates |
| GET `reports/:reportId/muse-analyses/:analysisId` | Saved validated interpretation; no model call |
| POST `proposals/:id/verifications` | Public source-HTML verification of an applied media-alt-only change |
| GET `proposals/:id/verifications/:verificationId` | Saved verification receipt; no collection |

Existing audit contracts/downloads are unchanged. The WordPress/Rank Math evidence is an additional source for a later AI assessment; it is not automatically merged into existing SEO Spy scores or page views.

See [saved evidence and interpretation contracts](WORDPRESS_REPORTS.md), [default-off Muse provider](MUSE_PROVIDER.md) and [media pilot workflow](WORDPRESS_STAGING.md). WordPress-only interpretation is implemented with mocked evaluation; live model/budget setup remains pending. It has no execution tools or numeric SEO Spy score. Public image verification is separate from stored-field success; other field types remain unsupported.

## Content update workflow

1. Read the target. Select one resource (`pages`, `posts`, `media`) and its integer WordPress ID.
2. POST a proposal. Supported page/post fields: `title`, `content`, `excerpt`, `slug`. Supported media fields: `title`, `altText`, `caption`, `description`, `slug`. Unknown or resource-incompatible fields, empty patches and no-op changes are rejected.
3. Review returned `before`, `changes`, target, expiry and exact `hash`. Proposal expiry is 15 minutes. Any edited change requires a new proposal/hash.
4. Only after a concrete user instruction, enable writes for the intended operation and POST `{ "proposalHash": "<reviewed-hash>", "confirmed": true }` to its Apply endpoint.
5. Inspect the execution receipt and freshly collected stored fields. An applied result is distinct from public rendered SEO verification.

Example proposal body (illustrative ID/content; not an instruction to change the real site):

```json
{
  "resource": "media",
  "resourceId": 123,
  "changes": { "altText": "The approved description of this informative image" }
}
```

The server binds the proposal to business, installation, resource, before-values, modification timestamp and operator-token identity. Key rotation invalidates the ability to apply old operator proposals. The configuration write gate defaults to false; previews/reads work while writes are disabled.

Application uses an exclusive persisted execution marker and a per-target file lock. Repeating an operation with a completed receipt returns that receipt without another write. Concurrent proposals targeting the same resource cannot dispatch concurrently through this module. Both the content response ID and fresh stored field values are checked.

Preflight compares current before-values/modification time against the reviewed proposal. This is not atomic compare-and-swap on the WordPress server: a third party can still edit between our preflight GET and POST. Stronger cross-client concurrency requires verified conditional-write support or a server-side WordPress companion endpoint. Do not claim this initial module prevents every external editing race.

## Uncertain outcomes and local recovery

- Any failure after dispatch, including HTTP 4xx, may represent a partial WordPress mutation. It becomes `outcome_unknown`, not an automatic retry.
- A malformed/wrong-resource success response also stays unknown. An accepted write with unreadable fresh verification stays applied but verification is inconclusive.
- Unknown writes retain their target lock. If storing the outcome fails, the target lock also remains. A new proposal cannot bypass that unresolved target reservation.
- Successful outcomes are persisted before releasing the target lock. Failed preflight/target reservation is recorded as not dispatched where storage is available.
- Restarting the server does not erase proposal/started/outcome files. A start marker without an outcome is pending or unknown, never permission to resend.
- For a stale/unknown lock: disable writes, stop relevant workers, inspect the original operation/receipt and fresh remote state, then have the trusted operator record the reconciliation and remove only the identified stale lock. No automatic unlock, rollback, reconciliation API or expiry-based write replay is implemented. Preserve the original operation records. Do not run broad cleanup against the action directory.
- These are local file-based protections, not a distributed queue or transactional database. Protect the directory from untrusted local writers; inspect corrupt/partial records rather than treating them as missing. The full application approval/identity workflow remains the later AI-plan milestone.

## Rank Math behavior and limitations

Traffic-data discovery is separate from content SEO scores: [WordPress analytics availability](WORDPRESS_ANALYTICS_DISCOVERY.md). Site Kit has GA4/Search Console configured, but report reads currently return `missing_required_scopes` for the operator's WordPress user; Rank Math cached traffic summaries return `n/a`. No traffic endpoint or scoring integration has been added.

Audit outcomes now expose `status: success | failed | timeout | unsupported | unknown` and version `rank-math-audit-v2`, retaining availability, provider scores, findings and redacted per-stage diagnostics. HTTP 201 confirms receipt creation, not audit success. Legacy receipts receive unknown status on read without archive mutation. See [audit investigation](RANKMATH_AUDIT_INVESTIGATION.md) for the historical limitation, live tool schemas and independent post-evidence test. No sitewide retry was performed during that investigation.

The adapter uses fixed documented abilities rather than arbitrary plugin routes. It discovers the installed plugin identifiers/versions and the exact ability name/readonly annotation before using supported reads. Incompatible/missing abilities or inaccessible metadata remain unavailable with explicit limitations.

Evidence reads collect existing per-content scores and metadata. These are stored Rank Math optimization scores, not a fresh scan, Lighthouse measurement, search ranking or SEO Spy overall score. A content-modified date is not the scoring date. Rank Math's metadata helper can turn absent scores into zero; the adapter requires corroboration before publishing that ambiguous zero.

To request a fresh audit, explicitly POST `{ "requestId": "<new-uuid-v4>", "confirmed": true }` to `rank-math/audits`, with writes enabled. Despite a GET/readonly vendor annotation, this ability can contact Rank Math's remote service and update cached audit results. It is never triggered by ordinary GET evidence requests. Reusing a request ID returns the saved outcome; it never triggers the same audit twice. Read the receipt later through GET.

Audit output includes a separate version, collection time, provider source-run time when supplied, availability, score, remote coverage status, findings and limitations. Invalid/empty results do not become a clean audit. Unknown/failed remote results are not silently converted to zero.

Rank Math SEO title/description **writes** are not implemented through generic `meta` updates. They require a dedicated capability/field mapping and approval adapter. Excerpts are not SEO meta descriptions. Generic body replacements are blocked for detected Elementor-built content. Attachment alt text may not update already embedded/widget-specific alt text; public rendering needs separate verification. Creation/deletion, plugin/theme/user administration, shell execution, generic HTTP and paid Content AI actions are outside this module's allowlist.

See [Rank Math adapter compatibility notes](RANKMATH_API_NOTES.md), [dated standalone access verification](WORDPRESS_ACCESS_VERIFICATION.md), [module verification](WORDPRESS_MODULE_VERIFICATION.md), and [future AI/action plan](AI_AGENT_INTEGRATION_PLAN.md).

## Verification

`npm run check` from `server/` runs typecheck, ESLint, controlled Jest/Supertest fixtures and build. Added coverage includes HTTPS/DNS pinning, unsafe destinations, redirects, deadlines/limits, credential redaction, operator/Origin/business guards, DTO validation, write-disabled defaults, proposal binding, stale targets, no-op/Elementor rejection, same/different-proposal concurrency, uncertain writes, failed outcome storage, retained locks and Rank Math score/audit availability and request replay. Tests neither load the live `.env` nor change the site.

No frontend changes or new provider calls are made by loading the module. Optional live checks must be separately authorized; never run the Apply or fresh-audit endpoints as a routine smoke test against the real business site.
