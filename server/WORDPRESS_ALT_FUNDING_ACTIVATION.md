# Exact WordPress-alt funding activation

Subsequent separately authorized outcome: [one live generation completed and saved for human review](WORDPRESS_ALT_FIRST_LIVE.md). The intent below is consumed; its approval cannot be reused. No WordPress change occurred.

November 2, 2026. User explicitly approved the revised one-request maximum of34090micros ($0.034090). This funds preparation only; no paid dispatch or WordPress update is authorized.

## Scope and immutable hashes

- Business `demo-guzman`; media5659; published parent page5652; owner context `5b14c90d-5ba1-4775-b1a8-32af42d63e8e`.
- Request SHA-256 `5e36713e596ebc536cdeb62391e4b2ab1388bd65228e9eceb0a794cee379740c`.
- Revised policy SHA-256 `c14b0fb31a49b0e63576b54c41e2762a4812e5c5c1a200c513ff5a47b28d3def`.
- Exact funding SHA-256 `77895e88f36aca89e87faa08e0d6c415565b06a3268a7dc271fed2cd9ba4463b`.
- Model spark1.3 Standard/minimal, maximum1500 output tokens; conservative22172 input tokens;4519 serialized bytes; no tools/grounding/retries/fallback/streaming/background/provider storage. Text-only; no visual-inspection claim. Meta-required `tool_choice:auto` remains with empty tools.

Policy v2 adds475micros of ceiling only for this exact business/context/request hash. Other scopes retain the old33615 ceiling. The singleton grant/intent, central ledger, administrator identity, atomic reservation, private provider transport and immutable receipts are unchanged. No general development or assessment permission was expanded.

## Verification and allocation

Fresh authenticated GET/OPTIONS and protected public page/image checks matched the original media/page, empty alt, edit capability, exact placements, original and responsive image bytes, business identity and reviewed Spanish context. Durable purpose binding `4b8345e7-0690-4460-8bca-d053297bff1d` retains original actor and confirmation time `2026-11-02T19:11:45.806Z`. Technical state was refreshed without creating a human review. Original reports remain immutable.

The funding grant was activated at `2026-11-02T20:02:30.646Z`. The first intent step failed locally because of incorrect provider constructor wiring; no intent or attempt was created. Wiring was corrected. The separate `funded-intent` command uses the existing exact grant, never reactivates it, checks fresh target state and rejects an existing singleton intent. The failure did not consume a paid attempt or create a provider request.

Allocation after earmark:

- WordPress-alt:34090micros,one attempt,zero charged/dispatched.
- Assessment testing:effective funded1820902micros; historical charge18782; remaining1802120 ($1.802120);three attempts used,six available.
- Combined unspent eligible funding remains1836210micros ($1.836210), of which34090 is restricted to this alt request.
- Historical development charge145008micros and original caps/counters remain unchanged. Demo usage/authorization remain zero/absent; protected$148 reserve is preserved.

Funding history hashes validate prior policy, consumed intents, attempts, testing allocation/receipts and diagnostic amendments. Recovery independently checks every pre-existing table row, current grant, original developer/demo summaries and attempt list. No ledger rows were reset or overwritten. Configuration/application files are checked unchanged; ledger modifications are solely the additive grant and scoped unapproved intent/link.

Artifacts: `reports/wordpress-alt-revised-funding-state.json`, `wordpress-alt-revised-funding-preview.json`, `wordpress-alt-revised-funding-activation.json`. Treat the activation artifact's intent ID and expiry as authoritative. It contains no API secrets or raw model response.

## Next approval, separately required

Scoped intent `96dfb73d-5c4f-413a-bc3e-78c5cfed0380` was created `2026-11-02T20:04:21.076Z`, expiring **2026-11-02T20:19:21.076Z** (12:19:21 Pacific). Independent read-only SQLite verification confirmed checksum, exact hash/reservation, one grant-linked intent, no approval/consumption, no attempt and no receipt. It is prepared, not paid-authorized.

Review the unapproved intent through existing local administrator `GET /api/ai/admin/intents/:intentId`. Separate paid authorization must name this intent, exact request SHA-256, maximum34090micros and exactly one live generation. Only then may the existing administrator approve endpoint receive:

```json
{"confirmed":true,"requestHash":"5e36713e596ebc536cdeb62391e4b2ab1388bd65228e9eceb0a794cee379740c","reserveMicros":34090}
```

Route: `POST /api/ai/admin/intents/:intentId/approve`, using the existing server-only administrator credential/local Host/origin guards. No such approval was made here. Approval expires with the fifteen-minute intent. If it expires, stop for explicitly reviewed reconciliation; the singleton intent cannot be automatically renewed, replaced or recycled.

After separate explicit live-dispatch authorization, existing `fix-operator/generations` accepts the exact approved intent, owner evidenceId and empty instructions with confirmation. Revalidate technical state if necessary; factual/dependency changes require a new request hash and cannot consume this grant. Normal process remains mock-first, AI-disabled, zero development budget and WordPress writes-off. A paid generation grants no WordPress write approval. Proposal review, explicit exact before/after approval, fresh execution checks, verification and separate restoration approval remain required.

## Implementation and checks

Changed only the scoped funding policy/receipt bound, funding tests and the preparation CLI's explicit funding/intent commands, plus documentation. The CLI has no approve/reserve/generate/apply operation and gives its intent-only provider a transport that always rejects dispatch.

Backend `npm run check`:86 suites,1848 tests,one existing skip; typecheck,lint and production build passed. Focused funding/API/receipt suites:87 tests passed. CLI lint was repeated after correcting wiring. No model requests, WordPress writes, scoring/Dashboard changes, commits, pushes or deployment.
