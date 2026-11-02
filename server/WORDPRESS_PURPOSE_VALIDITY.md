# Evidence-bound WordPress image purpose

Subsequent approved funding step: [exact revised earmark activated and single unapproved intent prepared](WORDPRESS_ALT_FUNDING_ACTIVATION.md). Earlier no-funding/blocker statements below describe this implementation checkpoint. Purpose validity and all execution safeguards remain unchanged.

November 2, 2026. Owner purpose and execution readiness now have independent validity. No funding activation, paid request, WordPress write, budget change, commit or push was performed.

## Durable owner decision

`wordpress-purpose-dependencies-v1` binds the original owner record, actor and confirmation time to the business/site, exact media and parent page, authoritative URL catalog, original image bytes, rendered variant bytes, authenticated/public placements, page context and reviewed purpose/description/language. It excludes operational read clocks and mutable alt values. Repeated technical checks never fabricate a human timestamp.

Material changes invalidate reuse permanently for that binding, including changed image contents, placement, relevant page context, business identity or a superseding owner decision. A new explicit owner confirmation is required. Empty alt is never automatically a defect; decorative purpose cannot authorize informative generation.

Historical records remain unchanged. Legacy confirmations keep their original expiry unless explicitly adopted with a verified original image hash and provenance through the guarded `purpose-adoption` endpoint. Adoption appends technical binding/state records, not an owner confirmation. Missing original identity evidence requires a fresh owner review. New enrollment can explicitly opt into durable binding; incomplete adoption fails closed.

## Short-lived execution readiness

Execution snapshots expire after at most fifteen minutes. Fresh actions re-read media/page ownership, edit-context permissions, current alt and modification preconditions, public association and image fingerprints. Failed permission/before-value checks invalidate machine readiness without expiring unchanged owner purpose. Changed alt/modification state needs compatible new page-scoped evidence; it cannot silently replace the original report. Source evidence retains its seven-day limit.

Proposal hashes/expiry, exact administrator approval, paid-intent expiry, single-use authorization, persisted execution locks and independent stored/public verification remain enforced. Replayed/concurrent approval and uncertain writes fail closed. Restoration remains separately approved with fresh preconditions; it never renews purpose.

Guarded routes under `/api/wordpress/businesses/:businessId/fix-operator`:

- `POST purpose-adoption`: explicit original review hash, verified original image SHA-256/provenance and dependency-unchanged attestation.
- `POST execution-state`: confirmed technical refresh; optional exact new immutable source report/finding/evidence reference.
- Existing revalidation is read-only. Capability distinguishes reusable purpose from stale execution state, without frontend presentation changes.

`scripts/wordpress-purpose-state.mjs` supports explicit `adopt`, `refresh` and read-only `status`. It requires mock-first/writes-off settings and the existing private operator. It checks prior records and protected spending/configuration bytes, never instantiates the spending provider, and does not migrate the application schema.

## Guzman verification

The original Spanish review `5b14c90d-5ba1-4775-b1a8-32af42d63e8e` remains confirmed at `2026-11-02T19:11:45.806Z`, with its historical expiry unchanged. Verified image baseline SHA-256 `60f7fd3ef623ef8f63fea1aaf8d6d0e7b8422294a8ad084081855e0cea470970` matched current bytes. Authenticated/public page5652, media5659, empty alt and permissions matched the original evidence. Technical binding `4b8345e7-0690-4460-8bca-d053297bff1d` has dependency hash `8f523fdaee40a15092c87436502f8edbafbcb196f5517eb4fa4eab6d3288c3d0`.

The appended execution state expires `2026-11-02T20:09:10.043Z`; subsequent expiry requires machine refresh, not a repeat owner decision if dependencies match. Original source report `e739442b-185f-4b89-ae12-a8273bb6bdbc` and every prior fix record remained unchanged. Protected ledger/configuration files were byte-identical before/after. Local artifacts: `reports/wordpress-purpose-adoption.json`, `wordpress-purpose-status.json`, `wordpress-purpose-request-preview.json`.

Durable request input v3 includes the dependency hash; old v1/v2 payloads remain compatible. New exact request SHA-256:

`5e36713e596ebc536cdeb62391e4b2ab1388bd65228e9eceb0a794cee379740c`

4519 request bytes; conservative22172 input tokens;1500 output tokens; spark1.3 Standard/minimal, strict existing output v1, text-only. No claim of Muse visual inspection. Maximum reservation **34090micros ($0.034090)**. Stable technical refresh timestamps are excluded from model input; changed factual inputs require a new hash.

## Funding remains blocked

The prior $0.033615 funding ceiling and old590c... request approval were not changed or reused. The new maximum exceeds that ceiling by475micros. No funding grant, intent or approval was created. The existing singleton funding policy requires a separately reviewed amendment/new exact funding proposal before this request can be authorized. Do not run activation against the obsolete runbook hashes.

Next steps:

1. Review the475micros increase and narrowly amend only the one-attempt WordPress-alt funding policy after explicit authorization. Recalculate policy/funding hashes and recheck protected$148 reserve, historical rows and current headroom. No reset or general assessment allowance unlock.
2. Explicitly refresh technical state when needed: `node --env-file=.env scripts/wordpress-purpose-state.mjs refresh --confirmed --business-id=demo-guzman --evidence-id=5b14c90d-5ba1-4775-b1a8-32af42d63e8e --output=NEW-LOWERCASE-NAME.json` (use a new lowercase filename).
3. Rebuild exact request/funding previews with `prepare-wordpress-alt-proposal.mjs`. If any dependency/factual input differs, review the new hash. The current funding-preview correctly rejects34090 against the unchanged33615 ceiling.
4. Obtain separate exact funding approval; activate only the reviewed earmark through existing AI administrator routes. Then create the scoped intent via existing operator estimates, review it and separately approve its exact request hash/reservation within its validity window. An expired intent is not automatically replaced or recycled.
5. Only following explicit live-dispatch authorization, generate once through the protected provider. WordPress remains writes-off. Review/edit saved output, create a fresh exact proposal and separately approve Apply. Fresh before-value/permission checks, one-use execution reservation, independent stored/public verification and separately approved restoration still apply.

No final AI alt text or website modification is authorized by this implementation.

## Coverage

Fixture tests cover unchanged/stale state, original actor/time, changed original and responsive image bytes, public/authenticated placements/context, owner changes, decorative purpose, exact source ownership, changed alt/permissions, new evidence, deterministic adoption/concurrency, request-hash stability/change, replayed approvals, paid-intent expiry and historical behavior. Final backend `npm run check` passed:86 suites,1847 tests,one existing skip, typecheck,lint and production build. Results are recorded in `reports/wordpress-purpose-final-check.log`.

Implementation files: `src/modules/wordpress/wordpress-purpose.types.ts`, `wordpress-purpose.service.ts`, `wordpress-fix.types.ts`, `wordpress-fix.service.ts`, `wordpress-fix.controller.ts`, `wordpress.service.ts`, `wordpress.module.ts`, `wordpress-alt-request.ts`; `src/integrations/wordpress/image-content.ts`, `src/integrations/website/collector.ts`, `src/integrations/ai/meta-muse.provider.ts`; `scripts/wordpress-purpose-state.mjs`, `prepare-wordpress-alt-proposal.mjs`. Tests: `wordpress-purpose.spec.ts`, `wordpress-purpose-workflow.spec.ts`, `wordpress-image-content.spec.ts`, expanded `wordpress-alt-funding.spec.ts` and API route assertions. Documentation: this file, PLAN,README and WORDPRESS_FIX_WORKFLOW/WORDPRESS_ALT_FUNDING follow-up links. Existing funding/preparation implementation and unrelated Smart Planner work predate this change and remain uncommitted; no frontend files were edited for this task.
