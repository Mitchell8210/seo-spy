# Facebook recommendation → Meta Muse draft → approved Page post

The existing Dashboard and Social Media recommendation review can now prepare one text post for a saved Facebook posting recommendation. The surrounding pages and labels are preserved. The Facebook review dialog was specifically approved by the user.

Open the saved “Restart regular Facebook posting” recommendation, choose **Generate AI post**, review/edit its text and Page identity, then choose **Approve & Publish**. Opening or reopening review only reads saved state. Generation is an explicit live Meta Muse request under the existing shared cumulative $25 allowance; it does not publish. Publication requires the exact reviewed text's expiring proposal hash and a separate confirmed request. The published post ID, text and result persist in application SQLite; an independent Graph read checks the exact message and obtains its permalink. One post does not resolve an ongoing posting-cadence recommendation or change scores.

After publication, **Generate another post** explicitly starts a new draft for the same still-current recommendation. There is no one-post limit per recommendation; every post uses its own model request, saved receipt, exact-text approval and single-use publishing reservation. The existing cumulative AI allowance still applies. Closing with the X, Close button or Escape discards an unpublished draft, invalidates its approval and resets review. Reopening then offers **Generate AI post**; only that explicit click starts a new paid request. Discarded text is supplied as variation context for the next generation, while its accounting receipt is retained. Discarded drafts never appear in Recent Actions. If discard fails, the review stays open and shows the error. Interrupted generation and started/unknown/published actions cannot be discarded or automatically replayed. Previous published receipts remain in Recent Actions. Only a future explicit report/analysis determines whether the recommendation is still supported; publishing never marks regular posting complete.

New requests identify their predecessor with `previousPostId`. A unique predecessor-bound reservation makes duplicate clicks and replayed requests resume that same next attempt. The predecessor must be published, discarded, or a failed generation for an explicit fresh attempt; active draft, generating and uncertain publication states cannot advance. Unknown writes are never replayed or treated as successful.

Generation receives a bounded sample of prior Page text as context and requests a distinct angle and wording. Before proposal approval and again atomically before dispatch, the server rejects identical and near-identical text against all saved publishing actions for that business/Page and text in the selected saved Facebook report. Comparison normalizes case, punctuation, whitespace and website URLs and checks character-shingle similarity. Repeated model drafts are retained for manual editing with an explanatory error; there is no automatic paid regeneration. This prevents copied or lightly edited text, but does not prove semantic novelty or detect posts published elsewhere since the saved report; the owner still reviews the content.

The saved Guzman source checked November 3, 2026 is report `7c79519b-ccb8-4371-9eca-982f5dc6d94f`, Page `608911535631168` (“Guzman Tax Accounting & Associates”), recommendation `58a7713a-f468-4556-b9c8-3f3c0592d0ce:2`. These IDs are diagnostic observations, never application constraints.

## Setup and boundaries

- Run backend and frontend using the same hostname (`localhost` by default), with the existing encrypted Facebook browser connection. The HttpOnly cookie remains scoped to `/api/facebook`; no tokens or operator keys enter frontend code.
- Set `FACEBOOK_POSTS_ENABLED=true` on the local server and restart it. New installations default to false; draft generation works with writes off. The current development `.env` was enabled for this requested workflow.
- The Facebook Login configuration must grant `pages_manage_posts` in addition to the existing read permissions. If it is missing, update the configuration in Meta and reconnect through `/api/facebook`. The Page must also return a content-creation/full-control task. Existing read authorization alone does not permit publishing.
- The saved report selects the Page. A request cannot supply another Page, access token or arbitrary endpoint. Server-side Page listing verifies current authorization again before writing.
- This remains a local operator/browser workflow. Facebook access is not production business ownership or multi-user application authentication.
- Text posts only. Images, scheduling, automated recurring posting, editing/deletion of published posts and automatic completion of the recommendation are outside this implementation.

Meta reference: [Pages API posts](https://developers.facebook.com/docs/pages-api/posts/). Publishing uses `POST /{page-id}/feed` with a Page token, `message` and `published=true`; readback requests `id,message,permalink_url`. The official page returned HTTP 429 during this implementation's documentation check, so actual permission/task compatibility still requires a live connected-browser publication.

## API

All routes use the existing Facebook browser cookie, strict local Host/Origin validation and `Cache-Control: no-store`. Mutations require same-origin JSON. Swagger documents the response fields. Responses never contain the session identity or tokens.

| Route | Input | Behavior |
|---|---|---|
| `GET /api/facebook/posts` | `businessId` and `id`, or `reportId,recommendationId` | Saved browser-scoped result or null; no provider calls |
| `GET /api/facebook/posts/history` | `businessId` | Up to 100 saved publishing actions for this browser/business; excludes unexecuted drafts; no provider calls |
| `POST /api/facebook/posts/draft` | `businessId,reportId,recommendationId,findingId?,previousPostId?` | Validate current recommendation and Page; generate once for the first attempt or the explicit predecessor-bound next attempt |
| `POST /api/facebook/posts/proposal` | `businessId,id,text` | Save exact reviewed text, 15-minute expiry and target-bound approval hash; no provider calls |
| `POST /api/facebook/posts/discard` | `businessId,id` | Discard only an unpublished draft/failed generation and invalidate its approval; browser-scoped and idempotent; no provider calls |
| `POST /api/facebook/posts/publish` | `businessId,id,approvalHash,confirmed:true` | Revalidate access/gate/permission/task, atomically reserve, dispatch once, save acknowledgement and independently verify |

The new `facebook_posts` table is independent of immutable source reports, assessments and the protected AI spending database. Records are schema-validated and checksummed. Concurrent writes use an atomic state transition before dispatch. A timeout, malformed write acknowledgement or interrupted `publishing` state cannot automatically replay. Check the Page manually before creating a new action if the result is unknown. Successful publication remains saved even if readback fails. Existing scopes/cache contracts remain compatible.

The Dashboard's user-renamed **Recent Actions** section combines these saved publishing actions with the existing applied WordPress fixes, newest recorded execution/completion first. Facebook cards include approved text, Page identity, publication/verification status and the post link when acknowledged. Drafts are excluded and uncertain outcomes are explicitly marked for attention. Partial source failures retain the other source's records. New publication records save execution/completion timestamps; older records without them remain visible without an invented publication date. A `facebook-post-updated` browser event refreshes saved action history after publication, without another provider request.

## Verification

`node scripts/facebook-post-preflight.mjs [--business-id=ID] [--permissions]` reads saved sources/configuration and shared allowance status. Optional permission checking uses only a separately configured server diagnostic token; it cannot establish the browser's permission state. It generates no model requests or posts.

Focused server tests exercise exact text, hashes/expiry, authorization/origin/confirmation, missing permission/task/Page, default-off writes, concurrent publishing, durable unknown states, saved reads and shared-ledger accounting through a fake model transport. The offline Social Media Chrome test covers generation, editable text, explicit publication, result permalink and reopening without another write; screenshots are stored in its reported artifact directory. These fixtures make no live Meta requests.

No live draft or Facebook post was generated during implementation. Live Page publishing and its exact-message readback remain to be demonstrated through the approved browser flow.
