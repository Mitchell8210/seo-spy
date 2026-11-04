# Smart Planner backend and integration plan

## Apply confirmation animation — November 2, 2026

User-approved frontend polish: after a validated successful Apply Plan response and calendar refresh, the existing dialog shows an animated checkmark with “Plan applied!” / “Your schedule has been saved,” then closes automatically after two seconds. Pending/failed writes never show success; failed applies keep the preview/error open for deliberate retry. Reading an older applied proposal does not trigger the animation or auto-close. Timer cleanup and existing abort checks protect unmount/business switching, and reduced-motion preferences show a static confirmation. Normal proposal/configuration layouts and backend, provider/accounting and application behavior remain unchanged.

Frontend lint/build and planner API/AI checks passed. All **16 offline browser scenarios** passed, including pre-acknowledgement/failure behavior, automatic close, persisted reload, reduced motion and earlier planner regressions. Desktop/mobile success screenshots were inspected: `client/node_modules/.cache/backend-lab-smoke/run-WfiP07`. No paid model requests or external writes were made; no backend runtime change required a new backend test run.

## Explicit Undo Done — November 2, 2026

Completed report and custom tasks now offer **Undo Done** in the existing task editor/details dialog. It calls `POST /api/businesses/:businessId/smart-planner/tasks/:taskId/undo-completion` with the existing revision/mutation-ID DTO. Only this explicit operation can restore `Needs Action`; ordinary PATCH status updates and source reconciliation still cannot reopen completed tasks. The schedule, guidance, identity, provenance and estimates remain unchanged. Failed saves keep Done visible; safe retries reuse the mutation ID and no UI success is shown before persistence.

The former completion timestamp is retained in optional internal task JSON `completionUndoHistory: [{completedAt,undoneAt}]`; the active `completedAt` becomes null to match `Needs Action`. Repeated Done/Undo cycles append history without rewriting earlier events. The journal is bounded at 500 entries (then fails closed rather than truncating history), within existing record-size protections. Old task payloads remain compatible; no SQL migration, new public fields or new UI history section is required. Explicitly reopened historical report tasks remain visible even if their original source has retired; they retain their original guidance/provenance rather than pretending new evidence exists.

The operation is atomic, business-scoped and revision-protected with durable receipts. Replaying an older undo cannot undo a subsequent completion; older AI proposals become stale. No provider calls, AI accounting changes, automatic task resets, developer-database status edits or other-agent workflow changes were made.

Verification: **72 focused HTTP/Swagger tests** passed. Full `npm run check` passed typecheck, lint, **102 suites / 2,180 tests / one existing skip**, and build (`server/node_modules/.cache/planner-undo-check.log`). Frontend lint/build/API checks and **15 offline browser scenarios** passed, including failed-save/retry, preserved schedules/history, reload, repeated completion and all prior planner flows. Artifacts: `client/node_modules/.cache/backend-lab-smoke/run-59lmmP`; desktop/mobile Undo Done screenshots were inspected. Tests use disposable databases and offline fixtures with zero paid/provider/fix requests.

## Custom task deletion — November 2, 2026

Verification: **69 focused HTTP/Swagger tests** passed. Full backend `npm run check` passed typecheck, lint, **102 suites / 2,177 tests / one existing skip**, and build (`server/node_modules/.cache/planner-delete-check.log`). Frontend lint/build/API checks passed. All **14 offline browser scenarios** passed, including confirmed custom deletion and the existing planner/AI regressions; artifacts: `client/node_modules/.cache/backend-lab-smoke/run-SpJ1fK`. Desktop/mobile confirmation screenshots were inspected. Browser fixtures separate deleted IDs from the independent oversized-task AI-deferral fixture and wait for dialog-close rendering before opening the next editor. No paid requests or user-database deletions occurred.

User-requested deletion is available from the existing task editor dialog for `mode:custom` only, whether scheduled, unscheduled or Done. **Delete custom task** opens an inline confirmation; Cancel preserves the task, and **Confirm Delete** calls `DELETE /api/businesses/:businessId/smart-planner/tasks/:taskId` with `DeletePlannerTaskDto` (`expectedRevision`, `mutationId`, `confirmed:true`). Report/demo tasks never show this control and the backend rejects attempts to delete them. This removes a custom task from the current planner/calendar, not prior immutable AI proposal/audit records.

Deletion is business-scoped and atomic with revision advancement and durable mutation receipts. The repository now persists removal of custom rows in the same transaction as the planner state/receipt; a second guard refuses removal of any report task through a collection rewrite. Failed writes roll back the deletion; duplicate retries do not recreate a task. Old AI proposals become stale and cannot restore deleted work. Source reconciliation does not recreate custom tasks. No migration, paid provider request, protected accounting change, WordPress/Fix change or actual deletion from the developer's application database was performed during implementation.

Offline coverage includes protected report tasks, confirmation, cross-business IDs, stale revisions, scheduled/completed custom deletion, physical row removal, durable retries/restarts, stale AI apply, and rollback after receipt storage failure. Browser coverage adds report-control absence, confirmation cancellation, failed-save/retry, scheduled and unscheduled custom deletion, unchanged report history, reload persistence and desktop/mobile confirmation screenshots.

## Bulk unscheduling — November 2, 2026

Verification: focused HTTP/Swagger tests passed (42 cases). Full backend `npm run check` passed typecheck, lint, **102 suites / 2,174 tests / one existing skip**, and build (`server/node_modules/.cache/planner-unschedule-check.log`). Frontend lint/build and all planner script tests passed; all **13 offline browser scenarios** passed after running Chrome outside the sandbox (sandboxed Chrome and Edge stalled at `Page.enable`). Browser coverage includes the primary Muse control, removed free button, Unschedule All failed-save/retry/empty disabling, responsive weekly/monthly views, business switching, completion/history and explicit AI apply. Artifacts: `client/node_modules/.cache/backend-lab-smoke/run-gfpisu`; desktop and mobile screenshots were inspected. No paid model/provider/fix requests, commits or deployment occurred.

User-requested `POST /api/businesses/:businessId/smart-planner/unschedule-all` atomically clears every calendar placement in the business, including Done tasks, without deleting tasks or changing completion timestamps, guidance, estimates or provenance. It uses the existing `PlannerMutationDto` revision/mutation-ID checks, durable receipts, repository transaction and response contract. No migration or AI/provider request is involved; prior pending AI proposals become stale through the normal revision check.

The existing calendar header now offers **AI Plan with Muse** as its primary action and **Unschedule All** as a secondary action, disabled while loading/saving or when no placements exist. The Auto Plan (Free) button was removed as requested; its deterministic API and parity tests remain compatible. Existing session handling supplies confirmed-save feedback, failed-write preservation, safe retries and business-switch protection. Other controls/layouts are unchanged.

The user's current `demo-guzman` schedule was reset through the checksummed repository mutation: revision 73 → 74, 24 placements cleared, all 25 stored tasks retained, and both Done tasks' completion/history fields preserved. Mutation receipt: `8d10ffcc-7790-48bd-b58b-e56486d1ce80`. All non-scheduling task fields were compared before/after; a fresh repository read confirmed no remaining placements. No other business, historical AI proposal or protected accounting record was modified.

AI-assisted roadmap extension: [dedicated implementation tracker and contracts](SMART_PLANNER_AI_PLAN.md). Schema 7 adds separate AI preferences/proposals; explicit offline generation, review and atomic apply are separate from existing free deterministic planning. No existing scoring/Fix prompt or financial allocation changes. Live generation remains blocked pending dedicated authorization and a compatible planner response-size policy.

Created: November 2, 2026. Status: complete and ready for local end-to-end testing.

Final checkpoint including the duration/multiweek upgrade: `npm run check` from `server/` passed 89 suites with 1,892 passing tests and one existing skip, plus typecheck, lint and production build. Frontend lint/build and planner regressions passed. The final offline browser run passed ten scenarios with 27 screenshots. No Smart Planner shared-file blocker remains; all earlier Swagger/documentation and browser verification deferrals below are resolved. Earlier checkpoint counts below describe the original integration.

Smart Planner turns saved audit findings and assessment recommendations into a business work schedule. Its NestJS module stores durable planner records in the existing SQLite application database and connects the existing frontend controls without redesign. Planner completion records the user's assertion of work; it never marks an audit finding verified or executes an external fix.

This is the tracking document for the work. The user approved implementation on November 2 with the refinements below. Check the progress log for implemented contracts and validation.

## Approved implementation decisions

- Backend SQLite becomes authoritative. Existing localStorage data stays untouched; import is deferred and no import endpoint will be added.
- Completed tasks never reopen from ordinary reads or saved-source reconciliation. Keep original completion timestamps, guidance and exact provenance. A genuinely newer authoritative scan may warrant a separate backend review marker only where exact identity establishes the relationship; no fuzzy matching or verification claim is permitted.
- Reconciliation reads saved Website, Facebook and validated consistency evidence only. Distinguish available, empty, pending, unavailable and failed reads; preserve work whenever evidence cannot be read authoritatively.
- Existing UI locations may receive accurate source/persistence wording and loading, saving and error feedback. Preserve all design, styling, sections and interactions; acknowledge a successful write before claiming persistence.
- Preserve deterministic scheduling parity, manual overlapping schedules, atomic business-scoped writes, durable mutation IDs and revision checks. Conflicts preserve user intent instead of overwriting newer state.
- Other agents' AI Fix, WordPress, Muse and accounting files are protected. Defer active shared files while independent work continues; request coordination only when a genuine conflict prevents progress.

## Current page and use case

The page is assembled by [SmartPlanner.tsx](../client/src/pages/SmartPlanner/SmartPlanner.tsx), [useSmartPlanner.ts](../client/src/hooks/useSmartPlanner.ts), and the [planner components](../client/src/components/planner/). A business comes from the `businessId` query parameter, with the existing demo business as fallback.

| Existing field or control | Current behavior | Backend requirement |
| --- | --- | --- |
| SEO Recommendations | Maps assessment `top` plus `remaining` issues into tasks | Return the equivalent complete task projection, with source provenance and deterministic ordering |
| Active Tasks, Urgent, Medium, Low, Done | Counts tasks and their planner status | Preserve task status and priority enums; retain current client calculations |
| Plan Completion (This Week) | Done divided by all scheduled tasks in the current Monday-to-Sunday week; empty week is 0% | Return all relevant tasks, including completed history; browsing another week must not change this KPI's anchor |
| Schedule task, Save Schedule, Unschedule | Sets or clears a date and integer hour | Persist a nullable schedule; unscheduling keeps the task |
| Drag and drop | Moves tasks in weekly/monthly calendars | Use the same schedule mutation as the dialog; manual overlapping slots are currently allowed |
| Auto Plan (AI) | Deterministic local priority/workload rules, no model call | Preserve the algorithm and existing explanatory copy; persist its result atomically |
| Use Weekends | Defaults off; turning off clears weekend schedules | Persist preference and clear affected schedules in one transaction |
| Add Custom Task, Plan Manually | Creates a custom task or schedules an existing task | Store title, priority, category, notes and optional schedule |
| Fix with AI, Manual Fix | Opens existing guidance; checkbox enables Mark as Done | Persist completion only; AI preview remains the existing preview |
| Re-scan | Previously refreshed saved Facebook results and reopened still-active tasks | Reconcile all saved channels explicitly; completed tasks stay Done |
| Calendar navigation and view | Local weekly/monthly selection and responsive interactions | Keep transient browser state; no database fields needed |

Task fields currently are `id`, `title`, `explanation`, `guidance`, `priority`, `category`, `source`, `mode`, `destination?`, `status`, `schedule?`, and `notes?`. Exact enums are `Urgent|Medium|Low`, `Admin|Content|Social|Search|Review`, `demo|saved|custom`, and `Needs Action|Done`. Schedules are local calendar dates plus hours 9 through 16 inclusive, with no duration or reminders.

[smartPlanner.ts](../client/src/services/smartPlanner.ts) maps Critical severity to Urgent, Low to Low and other severities to Medium. Its category rules and title/guidance fallbacks are part of the current mapping. Auto Plan keeps existing schedules, skips Done tasks, avoids occupied slots, balances daily load, prefers Monday for Admin tasks, and leaves overflow unscheduled after 40 weekday or 56 seven-day slots. Preserve its actual comparator and tie-breaking behavior through parity fixtures rather than approximating it.

[plannerPersistence.ts](../client/src/services/plannerPersistence.ts) stores version 1 under `seo-spy:planner:v1:<businessId>`. It keeps overrides, snapshots of completed source tasks, custom tasks and `useWeekends`. It retains completed history when a finding disappears, prunes vanished pending source edits only after a successful source read, and preserves state on pending/failed reads. It validates dates, enums, task identity, safe relative destinations, and weekend consistency. Persistence failures currently fall back silently to memory; that behavior must not be used to claim a failed backend save succeeded.

## Source facts and integration pitfalls

1. [useDashboardAssessment.ts](../client/src/hooks/useDashboardAssessment.ts), [dashboardAssessment.ts](../client/src/services/dashboardAssessment.ts), and [dashboardMuse.ts](../client/src/services/dashboardMuse.ts) now read saved Website and Facebook evidence and validated assessment interpretation. Website and consistency are not unconditionally demo data. Several planner messages and saved-task labels still describe Website/consistency as demo or all saved tasks as Facebook; these conflict with current data semantics.
2. The planner consumes `top` plus `remaining`, not simply all raw findings. Valid saved interpretation can replace top category cards with selected recommendations, including scoring observations. A source adapter must reproduce this behavior and distinguish an assessment observation from an original finding. Review potential duplicate underlying findings when an assessment recommendation and a raw remaining finding refer to the same evidence; do not silently collapse current visible rows.
3. Current task IDs are `<category>:<issue.id>`. Finding IDs may change across reports, and interpretation issue IDs include analysis/recommendation IDs. Titles are not reliable identities. The task mapping currently drops `findingId`, `fixReview`, and detailed assessment provenance; persistence needs richer server-side origin references without adding visible fields.
4. [useDashboardReports.ts](../client/src/hooks/useDashboardReports.ts) periodically reads Facebook results and refreshes on focus. Those ordinary reads must not reopen completed tasks. Reopening belongs to the explicit saved-source reconciliation action. Existing Re-scan only refreshes Facebook and uses a single saved-source success flag; do not propagate that flag to unrelated source channels in the backend.
5. [backendApi.ts](../client/src/services/backendApi.ts) currently wraps GET/POST only. Add method support deliberately or create a planner-specific transport using the same error conventions. Handle a late response after business switching and abort obsolete reads; never submit the previous business's state under the new ID.
6. The existing [server guidance](AGENTS.md), [README](README.md), [PLAN](PLAN.md), and [database design](DATABASE.md) establish NestJS, native Node SQLite, prepared statements, transactional migrations, immutable source archives, and separate protected AI accounting. Do not introduce an ORM, another database, background worker, or provider call for this feature.

## Implemented module boundaries

`src/modules/smart-planner/` contains the module, controller, application service, SQLite repository, saved-source adapter, deterministic scheduling helper, domain types and request/response DTOs. Relative imports use `.js` suffixes. The controller validates HTTP inputs; the service coordinates source reads and transactions; the repository owns SQL. Sources resolve through existing stores/services and pure saved-evidence analysis. Runtime backend code never imports client implementation files; parity tests execute the actual client mapping/scheduler against offline fixtures.

The asynchronous `PlannerRepository` interface and `SMART_PLANNER_REPOSITORY` symbol are exported through [repositories.ts](src/persistence/repositories.ts), with an explicitly registered SQLite singleton using [AppDatabase](src/persistence/sqlite/app-database.ts). Domain types and response DTOs are re-exported from the shared contract files; implementations remain module-local. `SmartPlannerModule` is registered in `src/app.module.ts`.

Saved source reads and planner GETs must not create audits, run Lighthouse/Facebook requests, generate Muse output, call WordPress, or mutate source artifacts. Initial GET can project available source tasks with default planner state without inserting rows. The first explicit planner mutation may materialize planner/task records from validated saved sources. Source content comes from the server, never an arbitrary browser task snapshot.

## Implemented database tables

Schema 4 uses three small tables. A business planner header exists even when there are no tasks; task rows support history and schedules; immutable mutation receipts prevent duplicate writes after intervening submissions and restarts. These are separate from audit `findings` and `suggestions`, whose statuses have different meanings.

| Table | Columns and constraints |
| --- | --- |
| `smart_planners` | `business_id` primary key and foreign key to businesses; `use_weekends` boolean check default 0; positive `revision`; UTC `created_at`, `updated_at` |
| `smart_planner_tasks` | server UUID `id` primary key; `business_id` foreign key to planner; `task_key`; planner `status`; nullable `scheduled_day`, `scheduled_hour`; ordering `position`; validated `data_json` and checksum; unique `(business_id, task_key)` |
| `smart_planner_mutations` | primary key `(business_id,mutation_id)`; canonical `request_hash`, resulting `revision` and UTC `created_at`; retained across restart and intervening writes |

Add indexes for `(business_id,status)` and `(business_id,scheduled_day,scheduled_hour)`. Check status/kind enums and that schedule columns are either both null or both present with hour 9..16. Validate real calendar dates and weekends in the service. Do not add slot uniqueness: the current manual calendar allows multiple tasks in one slot; Auto Plan alone avoids occupied slots. Bound and validate JSON on reads as well as writes and preserve checksums in the existing database style.

`data_json` stores only whitelisted task content, exact `origin` references, category, source presence, timestamps and original guidance needed for custom tasks, unavailable sources and completed history. Origins include report hashes, finding/recommendation and assessment/analysis IDs where applicable, and evidence references. Completed tasks are never reopened or overwritten, so no separate reopened-task snapshot is necessary. SQL columns, checksum, deterministic business-scoped source ID and payload identity are cross-validated on read/write. No credentials, full provider reports, or protected AI records belong here.

The transactional schema migration machinery upgrades supported schema 1/2/3/4 databases through the original planner schema 4 to current schema 5, and initializes new databases through the same history. Allowed version checks and migration validation are updated together. Temporary-database tests verify prior records, adjunct tables, artifacts, original task payloads and migration timestamps are preserved. The protected AI ledger remains separate and is never opened by this module.

## Implemented HTTP contract

Base route: `/api/businesses/:businessId/smart-planner`. Business IDs are registered string identifiers, not UUID-only values. All endpoints first resolve the business; a UUID from another business cannot select or mutate a task. Route task IDs use server UUIDs. Source `taskKey` is the legacy key plus `@<stable UUID>` so different exact report origins never collide in completed history; custom keys remain `custom:<UUID>`. The client adapter uses `taskKey` as the UI ID and retains server IDs for mutations. Auto Plan uses the original legacy key only for tie-breaking; assignment results use unique IDs.

| Method and suffix | Request DTO | Response and behavior |
| --- | --- | --- |
| GET base | none | 200 `PlannerResponseDto`; read saved projection and persisted choices; no writes |
| POST `/tasks` | `CreatePlannerTaskDto` | 201 complete planner response containing the created task; custom task only |
| PATCH `/tasks/:taskId` | `UpdatePlannerTaskDto` | 200 planner response; change pending estimate, schedule and/or planner status |
| PATCH `/preferences` | `UpdatePlannerPreferencesDto` | 200 planner response; update daily limits, horizon, confirmed time zone or weekends; atomically unschedule weekend tasks when disabled |
| POST `/auto-plan` | `AutoPlanDto` | 200 planner response plus saved planning result; duration-aware rollover within daily limits and the selected horizon |
| POST `/reconcile` | `ReconcilePlannerDto` | 200 planner response including per-channel availability; refresh saved projection and preserve completed history |

Do not add deletion, arbitrary task content editing, reminders, recurring work, real AI scheduling, publishing, or external fix endpoints to this first slice; the page has no corresponding workflow.

Every write DTO includes `expectedRevision` (nonnegative integer, 0 for a planner not yet created) and a UUID `mutationId`. Perform compare-and-swap and the complete mutation in one `AppDatabase.withTransaction`. Increment the business planner revision once per mutation. Durable mutation receipts retain canonical request hashes and resulting revisions so retries never create duplicate tasks, including after intervening writes or restart. The same ID with a different request returns conflict. Automatic write retries are disabled. Test concurrent first creation and duplicate custom creation explicitly.

DTO rules:

- `CreatePlannerTaskDto`: trimmed required title 1..160 characters; exact priority/category enums; optional notes at most 2000 characters; optional nullable schedule. Server generates UUID/custom key and assigns source, mode, explanation/guidance defaults and initial Needs Action status, matching current custom mapping. Do not accept destination, origin, business ID, guidance or source claims from the browser.
- `UpdatePlannerTaskDto`: at least one of `status` or `schedule`; status is exactly Needs Action or Done. Require `completionConfirmed: true` for Done, representing the existing checkbox. Omitted schedule keeps it; explicit null clears it. Attempts to reopen a completed task are rejected. Completed tasks may still be rescheduled without replacing their completion timestamp or original guidance.
- `PlannerScheduleDto`: exact `YYYY-MM-DD` real date and integer hour 9..16. Nested validation must reject invalid objects and null required members; avoid optional validators accidentally treating invalid nulls as omitted fields.
- `UpdatePlannerPreferencesDto`: required boolean `useWeekends`.
- `AutoPlanDto`: valid date `weekStart` that is a Monday; use persisted weekend preference and current tasks. Preserve schedules, including those outside the target week; never call a model.
- `ReconcilePlannerDto`: `confirmed: true`; server selects saved source records and validates provenance. Never accept a browser list of active findings as authoritative.

Use class-validator/class-transformer, Swagger properties, strict unknown-field rejection, the shared ValidationPipe, request IDs and existing error envelope. Document 400 invalid input/weekend schedule, 404 unknown business/task, 409 `PLANNER_REVISION_CONFLICT` or mutation mismatch, and storage/source failures without pretending they are empty task lists. Add response DTOs for tasks, schedules, preferences, sources, reconciliation outcomes and errors; include all enum/nullability definitions in OpenAPI.

Example response shape, with enum values identical to existing client slots:

```typescript
interface PlannerResponse {
  businessId: string;
  revision: number; // 0 for a projected planner with no persisted header
  preferences: { useWeekends: boolean; dailyCapacityMinutes: number; maxTasksPerDay: number; horizonWeeks: number; timeZone: string | null };
  tasks: Array<{
    id: string; // server UUID; adapter retains separately for mutations
    taskKey: string; // legacy source key plus @UUID, or custom:UUID
    title: string; explanation: string; guidance: string;
    priority: 'Urgent' | 'Medium' | 'Low';
    category: 'Admin' | 'Content' | 'Social' | 'Search' | 'Review';
    source: string; mode: 'demo' | 'saved' | 'custom';
    status: 'Needs Action' | 'Done';
    schedule: { day: string; hour: number; minute?: 0 | 30 } | null;
    estimatedDurationMinutes: number;
    durationEstimateSource: 'default' | 'legacy-default' | 'user';
    scheduledBy: 'manual' | 'auto' | 'legacy-unknown' | null;
    destination: string | null; notes: string | null;
    completedAt: string | null;
    origin: Record<string, unknown> | null;
  }>;
  sources: Array<{
    channel: 'website' | 'social' | 'consistency';
    availability: 'available' | 'empty' | 'pending' | 'unavailable' | 'failed';
    reportIds: string[];
  }>;
  planning?: { policyVersion: 'planner-balanced-v2'; range: { start: string; end: string }; scheduledCount: number;
    remaining: Array<{ taskId: string; reason: 'duration_exceeds_daily_capacity' | 'no_contiguous_slot' | 'horizon_capacity_exhausted' }>; overloadedDays: string[] };
}
```

Unmaterialized source tasks derive UUIDs deterministically from business plus exact canonical origin using a versioned namespace, and persist those same IDs on materialization. Nullable response fields map to existing optional client fields. Counts stay derived from the returned task set; this-week completion retains its original current-week anchor.

## Source reconciliation and identity rules

Use an exact origin key incorporating category, source report/finding IDs or assessment/analysis/recommendation IDs. Preserve the current client key for compatibility, but reject collisions where the same key resolves to incompatible origin content. Do not automatically carry Done across a new report, changed recommendation revision, or different target. A new exact origin starts Needs Action and unscheduled; retain the old completed snapshot. Future cross-report semantic matching is a separate product decision.

Ordinary GETs and explicit reconciliation merge current sources with durable planner choices without changing completion. Re-reading a saved report never proves a completed fix failed. If a source is pending, missing, corrupt or fails to read, preserve its existing snapshots, status and schedules. A successful authoritative read with no active findings can retire pending source tasks from the visible projection; retain Done history and custom tasks. Keep retired rows rather than destructive cleanup in this slice. Changed exact origins produce new pending tasks without rewriting historical completed identities; no cross-report matching or review claim is inferred from similar copy.

Consistency depends on both source manifests and validated assessment output. Neither an isolated Facebook success nor absence of a selected recommendation proves a cross-channel issue resolved. Distinguish a valid empty selection from unavailable interpretation. Track per-channel outcomes and never prune or reopen dependent tasks from incomplete evidence. Reads must use immutable report IDs/hashes consistently, not a mixture of two latest snapshots changed during the request.

## Frontend integration decisions

Keep all existing sections, labels, icons, colors, spacing, layout, calendar interactions and KPI slots. Add transport/mapping in services and replace persistence orchestration in the hook. Preserve the current in-memory view during failed reads, serialize mutations per business, ignore obsolete responses, and adopt server responses only for the matching business/revision. Do not show Done or close a successful-save flow before persistence is acknowledged. Avoid optimistic updates initially; on 409 refetch and preserve user intent without automatic replay.

The following decisions were approved for implementation:

| Decision | Proposed direction and exact affected presentation or behavior |
| --- | --- |
| Browser-storage wording | Replace browser-only persistence statements with accurate backend-storage wording |
| Source wording | Correct demo claims and Facebook-only labels to reflect actual provenance |
| Save failures and pending operations | Reuse existing status/error locations with accurate planner loading/save/error feedback |
| Existing browser choices | Start backend integration without automatic migration; retain local keys/data; defer import endpoint |
| Re-scan source scope | Read all saved channels without providers and correct existing status messages; keep completed tasks Done |

If import is selected, add a separately specified bounded `POST /import` DTO and atomic receipt before wiring it. Accept valid custom content and planner overrides only; server-resolve source origins, reject ambiguous legacy IDs, and report unsupported entries. Preserve the original local key until import is acknowledged. A conflict with an existing server plan requires user resolution; no last-write-wins overwrite. Do not implement bulk state PUT as a shortcut.

Initial scope is one shared planner per business in the existing local-only application. Application identity and business ownership are not implemented globally. Business scoping prevents accidental cross-business ID reuse but is not authentication. Keep existing loopback deployment limits; do not reuse WordPress operator credentials as public planner identity. Per-user planners and shared/public access require a separate identity/authorization design before exposure.

## Work sequence and progress

Use `[ ]` pending, `[x]` complete, and record dated evidence below. Complete stages in order; UI-dependent work waits for the decisions above.

- [x] Review repository instructions, frontend page/components/hook, task mapping/storage/tests, and backend database/module/contracts conventions.
- [x] Record current behavior, proposed tables, DTOs, routes, limitations and collaboration boundaries.
- [x] Resolve required presentation, import and Re-scan decisions.
- [x] Implement isolated module domain, DTOs, source adapter and scheduler with focused new tests.
- [x] Implement the additive migration, repository token/provider, transaction semantics and restart tests in clean shared files.
- [x] Register module and implement controller/service/OpenAPI with focused HTTP contract tests.
- [x] Connect frontend services/hook with approved wording/error handling; preserve old localStorage data and defer import.
- [x] Update DATABASE and this tracking document with actual contracts and progress.
- [x] Add scoped README/PLAN summaries while preserving unrelated text and current AI Fix additions.
- [x] Add the six planner routes to the shared exact Swagger route-list test after confirming the target block was stable.
- [x] Run final full backend and frontend regression verification.
- [x] Complete desktop/mobile browser assertions and inspect screenshot evidence using offline fixtures.

### Verification acceptance criteria

Backend checks: `npm run check` from `server/`. Focused suites cover DTO unknown fields/enums/nulls/date/hour limits; business isolation; invalid origins; complete snapshots; successful-empty versus failed reads; completed-state preservation and new exact-origin identity; assessment observations and duplicate parity; stable IDs across GET/restart; create/restart; schedule clearing; manual overlap; atomic weekend clearing and Auto Plan; revision conflicts across two connections; mutation duplicate/mismatch handling; rollback; unavailable/corrupt database; migration preservation; and no provider or protected AI accounting calls. Tests use temporary databases, never the developer's database.

Frontend checks when implemented: `npm run lint`, `npm run build`, and `npm run test:planner` from `client/`. Extend existing pure planner assertions and fixture browser coverage for HTTP persistence, reload, business switching, completed history, source failures, write failures, stale responses and conflicts. Browser fixtures must use no real providers. Review the entire frontend diff against the strict preservation rule and visually compare the existing responsive page; authorized wording corrections must be listed explicitly in the handoff.

### Earlier verification checkpoints

Initial implementation validation: focused backend API/persistence/source/scheduler tests passed, including actual frontend mapping/scheduling parity. The first full backend run passed 79 suites/1701 tests with one existing skip and one failure: the exact Swagger route list in protected `tests/api.spec.ts` needed six planner entries. That file had active AI Fix edits; coordination was requested instead of overwriting them. Frontend lint/build and pure planner/API/session tests passed. The initial `test:planner` browser attempt timed out at CDP `Page.enable` before app navigation, and the native fallback was stopped by Computer Use URL policy. These historical blockers were resolved during final integration as recorded below.

After review fixes, the six focused backend suites passed 48 tests: Smart Planner API/persistence/source/scheduler plus existing assessment-store and Google-cache migrations. Source/scheduler suites account for 16 tests and API/persistence for 19. Frontend regression additionally passed 33 dashboard/Website/score mapping tests and opportunity assertions. An AST comparison against HEAD confirms every existing `className` expression in the modified planner page/components is unchanged. New fixtures cover two report origins sharing a legacy finding key without automatic slot collisions. The full-suite route-list failure is a coordination issue, not a missing route; focused OpenAPI checks verify the new contracts.

Two additional integration tests pass using the actual frontend `plannerApi`/`PlannerSession` code against an isolated Nest HTTP server and in-memory SQLite. They verify lost-acknowledgement retries produce exactly one task, completion persists through saved reconciliation, and a real stale-revision conflict refetches state without replaying the action. These requests are restricted to the loopback planner API; no source/provider request is permitted. Total focused backend coverage is 50 passing tests across seven suites. Final backend typecheck, lint and production build pass.

## Delivery file manifest

Created:

- `server/src/modules/smart-planner/planner.types.ts`, `planner.repository.ts`, `planner.service.ts`, `planner.dto.ts`, `planner.controller.ts`, `smart-planner.module.ts`, `planner-sources.ts`, `planner-scheduler.ts`.
- `server/tests/smart-planner-api.spec.ts`, `smart-planner-persistence.spec.ts`, `smart-planner-sources.spec.ts`, `smart-planner-scheduler.spec.ts`, `smart-planner-integration.spec.ts`, `smart-planner-restart.spec.ts`.
- `client/src/services/plannerApi.ts`, `client/src/services/plannerSession.ts`, `client/scripts/smart-planner-api.spec.mjs`.
- `server/SMART_PLANNER_PLAN.md`.

Modified:

- `server/src/app.module.ts`, `server/src/contracts/domain.ts`, `server/src/contracts/responses.dto.ts`, `server/src/persistence/repositories.ts`, `server/src/persistence/sqlite/app-database.ts`.
- `server/tests/assessment-store.spec.ts`, `server/tests/google-cache.spec.ts` to reconstruct supported old schemas accurately and expect current schema 5.
- `server/DATABASE.md`, `server/README.md`, `server/PLAN.md`, the API summary in `server/AGENTS.md` and the six-entry planner route addition in `server/tests/api.spec.ts`; existing AI Fix additions remain intact.
- `client/src/hooks/useSmartPlanner.ts`, `client/src/services/smartPlanner.ts`, `client/src/pages/SmartPlanner/SmartPlanner.tsx`.
- `client/src/components/planner/PlannerTasks.tsx`, `PlannerCalendar.tsx`, `PlannerDialog.tsx` for approved wording and confirmed-save handling in existing UI locations.
- `client/package.json`, `client/scripts/smart-planner.spec.mjs`, `client/scripts/backend-lab-smoke.mjs` for offline regression coverage.

No application database migration was run against the developer's real database during this work. Schema 4 is applied through normal startup on restart; tests use temporary/in-memory databases. No production deployment, commit, browser import, provider request or paid AI operation belongs to this delivery. The optional migration endpoint remains deferred. Review markers across changed finding identities are also deferred: without an explicit identity rule, the planner retains old Done history and creates a separate task for each new exact authoritative origin instead of claiming a failed fix.

## Coordination with other agents

At review, uncommitted work existed in `server/src/modules/wordpress/wordpress-fix.controller.ts`, `wordpress-fix.service.ts`, `wordpress-fix.types.ts`, `wordpress.service.ts`, and `server/tests/api.spec.ts`; new files included `wordpress-alt-request.ts` and later `server/tests/wordpress-alt-spanish.spec.ts`. This list is a dated observation, not permission to touch those paths.

Re-run `git status --short` and read current diffs before edits. Shared touchpoints include module registration, contract exports, persistence/migrations, overview docs and API route lists. The final-integration instruction permits safe minimal additions that preserve other agents' changes; a dirty file alone does not require another approval. If the needed block is actively changing, defer it and provide the exact minimal patch rather than overwriting it. The six-route Swagger block was unchanged from the earlier review, and the README/PLAN additions were isolated from the current AI Fix text. Final diffs contain additions only in those shared files. Never overwrite, stash, reset, or commit another agent's work.

### Progress log

| Date | Work | Evidence and next step |
| --- | --- | --- |
| 2026-11-02 | Context review and implementation plan | Added this document only. Next: resolve integration wording/import/source-scope decisions, then implement isolated backend files and coordinate shared migration/module registration |
| 2026-11-02 | Approved implementation and integration | Added backend module, schema 4 migration, durable task/history/receipts, source/scheduler parity tests, frontend API/session integration and focused regression tests. Preserved protected concurrent work and all localStorage data. Remaining: shared route-list/docs coordination and browser visual verification |
| 2026-11-02 | Final integration and cleanup | Completed Swagger expectations and README/PLAN/DATABASE/API-guide updates while preserving AI Fix edits. Full check: 84 suites/1772 passed/one existing skip plus typecheck/lint/build; browser: nine scenarios/23 screenshots. Ready for local testing; no shared-file blockers |

## Final browser and restart verification

The final offline Chrome run passed nine browser scenarios and produced 23 screenshots in `client/node_modules/.cache/backend-lab-smoke/run-iKMZBb`. Chrome and Edge both stalled before navigation inside the restricted shell sandbox; the approved elevated offline Chrome command resolved the renderer blocker without changing application code or browser security settings. All app requests used local fixtures; no provider, AI or external-fix request was made.

Weekly and monthly views passed at 1440, 768, 390 and 320 pixels, with no page overflow and the intended internal horizontal scroll for narrow monthly views. Create, schedule and guidance dialogs were checked at 1440, 390 and 320 pixels. Assertions and screenshots cover loading, confirmed completion saves, failed reads/saves, source errors, manual overlaps, drag/drop, deterministic Auto Plan, weekend scheduling, preserved Done history after reload/reconciliation, and unchanged legacy localStorage. Switching to a distinct business hides the prior dialog and tasks; a delayed prior-business response cannot restore them.

Screenshot review found and corrected one integration regression: failed loads/saves left stale Loading/Saving status copy. `plannerSession.ts` now clears those pending messages and keeps truthful failure feedback in the existing status/error locations. Focused frontend assertions and the final browser run confirm both fixes. No styling, component structure or interaction redesign was required. The harness additionally waits for dialog unmount before reopening it; this corrects a test timing race.

Representative evidence: [desktop weekly](../client/node_modules/.cache/backend-lab-smoke/run-iKMZBb/smart-planner-weekly-1440.png), [mobile monthly](../client/node_modules/.cache/backend-lab-smoke/run-iKMZBb/smart-planner-monthly-390.png), [narrow create dialog](../client/node_modules/.cache/backend-lab-smoke/run-iKMZBb/smart-planner-create-dialog-320.png), [save failure](../client/node_modules/.cache/backend-lab-smoke/run-iKMZBb/smart-planner-create-error-1440.png), [read failure](../client/node_modules/.cache/backend-lab-smoke/run-iKMZBb/smart-planner-load-error-1440.png), [business isolation](../client/node_modules/.cache/backend-lab-smoke/run-iKMZBb/smart-planner-business-switch-390.png). These fixture artifacts are intentionally ignored by Git and can be regenerated with the planner browser test.

The new HTTP restart regression closes the entire Nest application and recreates all providers against the same temporary SQLite database. It passes with stable task IDs, weekend preference, schedules, original completion guidance/timestamp/provenance, duplicate mutation receipts and cross-business isolation. Ordinary GET and explicit reconciliation after restart leave completed work unchanged. The protected AI provider and real application database are not part of this fixture.

## Final verification results and local readiness

| Check | Final result |
| --- | --- |
| Backend `npm run check` | Passed typecheck, lint, 84 suites / 1,772 tests with one existing skip, and production build; zero failures |
| Planner-focused backend coverage | 51 passing tests across eight suites, including HTTP transport integration and full Nest application restart |
| Client lint and production build | Passed after the pending-message correction |
| Client planner and API/session assertions | Passed, including safe ambiguous-write retry, real revision conflicts, stale-response suppression and no automatic browser import |
| Dashboard/Website/score mapping regressions | 33 passed, plus opportunity assertions |
| Offline planner browser regression | Nine scenarios passed; 23 screenshots at the widths and dialog states listed above; no runtime errors or external provider/fix requests |
| Preservation review | Existing planner styling expressions unchanged; scoped diff checks and local document links pass; AI Fix/WordPress/accounting files left to their owner |

The first final-check attempt passed all 83 then-current suites but caught a temporary compiler mismatch in the other agent's new WordPress image transport call. Those protected files were not edited by this work. After their transport signature was completed, the final full check passed all 84 current suites, including that agent's new image-content tests. No blocked shared-file change remains.

Smart Planner is ready for local end-to-end testing. Restart the backend normally to apply schema 5, refresh the frontend, and open the existing `/recommendations?businessId=<registered-business-id>` route or Smart Planner navigation item. Real developer database migration and live provider operations were not used for this QA. Remaining product limitations are the established local-only identity boundary, deferred optional browser import and no fuzzy matching/review claim across changed source identities; none blocks local planner testing.

## Calendar task details and unscheduled list

November 2 follow-up: the user explicitly requested full details when clicking a scheduled calendar task and removal of scheduled tasks from the left-hand list. The existing task dialog now shows the complete title, source/provenance, priority, category, status, description, guidance, distinct notes and source-report link alongside scheduling controls. Repeated note/guidance content is shown once rather than duplicated. Pending tasks can be marked Done from this dialog using the existing completion confirmation and acknowledged backend save; changing the selected task resets confirmation.

The left list now receives only unscheduled tasks. Scheduling removes a row only after the server confirms the change; unscheduling returns it. If every task is planned, no task rows remain in the list. Calendar contents, full task selection and KPI calculations continue to use all tasks. No backend, AI Fix, WordPress, persistence or localStorage behavior changed.

Frontend lint/build and `npm run test:planner` passed, including all nine offline browser scenarios with added checks for an empty fully planned list, unchanged total KPIs, complete calendar details and multiline custom notes, completion from the calendar, and return to the list after unscheduling. Desktop/mobile screenshots were reviewed from `client/node_modules/.cache/backend-lab-smoke/run-c1zWmT`, including the full details dialog at 320 pixels. Existing styling is reused for the explicitly requested details panel; the rest of the page structure is preserved.

## Duration and multiweek scheduling upgrade

Status: implemented and verified November 2. The user approved the proposed duration estimates, workload limits, planning horizon and scoped interface additions with “ok go ahead.” Workload-limited earliest-feasible rollover is the implemented policy; intentionally spreading flexible work across an otherwise empty horizon remains a separate policy option.

### Scheduling behavior and defaults

| Setting | Default | Rules |
| --- | --- | --- |
| Estimated task duration | 60 minutes | Editable choices: 30, 60, 90, 120, 180 or 240 minutes; explicitly a planning estimate, not measured effort |
| Daily workload budget | 120 minutes | Business planner preference; 30-minute increments from 30 to 480 minutes |
| Maximum tasks per day | 3 | Configurable from 1 to 16; separate from the time budget, and both limits must be satisfied |
| Planning horizon | 4 weeks | Configurable from 1 to 12 weeks, starting with the selected Monday |
| Working window | Existing 09:00 to 17:00 | New starts may use :00 or :30; a duration must fit contiguously before 17:00 |
| Working days | Existing Use Weekends preference | Monday through Friday by default; include Saturday/Sunday only when enabled |

Recommended policy: fill available capacity in the earliest feasible week, distributing work within that week, then carry the remaining work into later weeks. Urgent work gets the earliest feasible positions; Medium and Low work use duration-aware workload balancing. Preserve the Monday/Admin preference when capacity and urgency allow it. Use stable legacy ordering plus unique task ID as deterministic tie-breaks.

The horizon is an upper bound, not a requirement to fill every week. For example, twelve 60-minute tasks at two hours/day fill ten positions in the first complete workweek and two in the following week. Five 60-minute tasks still fit within one week. Urgent overflow uses the earliest feasible date; flexible work balances daily minutes within the earliest feasible week. The alternative full-horizon spreading policy would intentionally leave early capacity unused and is not enabled.

Duration estimates initially come from a transparent default or the user's edit. Do not infer supposedly accurate timings from a finding title, severity or AI prose. Persist the estimate source (`default`, `legacy-default`, or `user`) separately from evidence provenance. No paid inference or provider collection is needed.

### Duration and capacity rules

1. Represent occupancy as half-open local intervals `[start, end)`. A 90-minute task starting at 09:00 reserves time until 10:30. An automatic task cannot overlap any existing interval, including a manually overlapping group or a completed scheduled task.
2. Count existing scheduled work against both daily limits before adding new work. Sum task estimates for the time budget; union the occupied intervals only for collision detection. Existing manual overlaps remain allowed and unchanged. If a day is already over capacity, add no automatic work there and report the overload without moving tasks.
3. Keep each task contiguous on one day in the first release. A task longer than the daily budget stays unscheduled with `duration_exceeds_daily_capacity`; moving it weeks ahead cannot solve that constraint. Do not silently raise limits, shorten estimates or split the task.
4. Preserve all existing schedules and Done history. Auto Plan operates on unscheduled Needs Action tasks. New source reads, reconciliation, changed preferences and GETs never move tasks or reopen completed work.
5. Plan only within the bounded horizon. Return remaining task IDs and specific reasons such as `duration_exceeds_daily_capacity`, `no_contiguous_slot`, or `horizon_capacity_exhausted`. Continue placing other feasible tasks when one task cannot fit.
6. Changing a daily limit does not automatically redistribute existing assignments. Manual work may exceed daily budgets or overlap, with truthful feedback; new or resized intervals must still fit the visible working window. Reject an invalid end time instead of drawing a truncated calendar block.
7. Do not backdate automatic assignments. Persist a planner IANA time zone proposed from the browser and confirmed with planning settings; do not infer the business's location. Derive today/current local time from an injected backend clock in that zone. Skip past dates and elapsed half-hour starts; reject a wholly past horizon. Continue storing civil dates/times rather than converting calendar dates into UTC instants. Changing time zone requires an explicit settings save and never shifts existing civil dates/times.

Users who want to redistribute the current one-week plan can unschedule chosen tasks using the existing dialog, then run the upgraded Auto Plan. The first release will not silently rebalance their existing calendar. Record `scheduledBy: manual|auto|legacy-unknown` for future explicit replanning support; treat pre-upgrade assignments as `legacy-unknown`, since the current records do not reliably identify their origin. Bulk replanning remains a separate opt-in workflow, not a side effect of this upgrade.

### Persistence and API changes

Keep the existing NestJS module, SQLite database, endpoints, revision checks and durable mutation receipts. No new ORM, queue, worker, provider call or database is needed.

- Add `estimatedDurationMinutes` and estimate provenance to planner task records. These are planner choices and must not change a source origin hash or stable task ID. Estimate edits apply to Needs Action tasks; completed tasks show their historical/default estimate read-only. Completed guidance, timestamps, statuses and original provenance stay intact.
- Extend schedules compatibly to `{ day, hour, minute? }`, where minute is 0 or 30 and an omitted minute means zero. Never show a half-hour assignment under an hour-only label.
- Add business planner preferences for daily minutes, daily task count, horizon weeks and time zone. Keep `useWeekends` unchanged. Return the effective preference values in GET responses.
- Extend create/update task DTOs to validate duration edits and interval bounds. Extend preference DTOs with explicit optional fields; omitted settings keep their existing value. Unknown fields, invalid enum/null values and impossible intervals fail validation.
- Keep `POST /auto-plan` with `weekStart`, `expectedRevision` and `mutationId`; use persisted preferences and a versioned `planner-balanced-v2` policy. Return the effective date range, policy version, scheduled count, remaining task IDs/reasons and overload warnings alongside the existing planner state. The client must not claim that all work was scheduled when capacity is insufficient.
- Schema 5 extends header preference columns, adds normalized schedule minutes and adds nullable checksummed planning results to mutation receipts. It leaves all legacy task JSON/checksums and receipt hashes intact. Legacy tasks receive an effective labeled 60-minute default through the read adapter; new task payloads are version 2. Completed records keep original guidance, timestamps and provenance; a legacy default is never claimed as recorded actual duration. Earlier application tables, history and the separate AI ledger are preserved.
- Keep historical receipt hashes intact. A recognized duplicate mutation returns durable state without running either scheduling policy again. Fresh mutations still compare the business revision and commit the whole plan atomically; stale revisions never overwrite another session.
- Retain the current v1 pure scheduler and its parity fixtures as historical behavior. V2 receives separate deterministic policy tests. Coordinate backend/frontend response support and refresh clients during the local upgrade so older clients cannot silently discard minute/duration semantics.

### Approved frontend scope

Reuse the current page, KPI slots, task list, calendar navigation and dialog styling. The exact presentation additions proposed are:

- Add an Estimated duration selector to the existing create/schedule/task-details dialog and display the saved estimate with its default/user provenance.
- Add one Planning settings control beside Auto Plan, opening a compact dialog for daily hours, daily task count, horizon and time zone. This is the only proposed new planner control; do not add a new page or dashboard section.
- Add half-hour choices to the existing time selector. Render weekly task blocks at their actual start/end and duration within the existing hourly grid; the hourly labels can stay. Show accurate start/end information in monthly task blocks/details without changing the page layout. Test overlapping manual blocks and narrow screens rather than hiding intervals or rounding them to a different time.
- Use the existing status/error locations to explain the range planned, remaining unscheduled work and capacity warnings. Preserve dialogs after failed saves and require backend acknowledgement before showing a new schedule.
- Keep scheduled tasks out of the left list, including future weeks. Keep unscheduled overflow visible. KPIs continue to count all tasks, and Plan Completion (This Week) remains anchored to the current week rather than the whole horizon. Existing week/month navigation provides access to future assignments.

The user's implementation approval applies to these exact additions. Other dashboard, recommendation, AI Fix and WordPress presentation remains outside this task.

### Implementation sequence and acceptance checks

- [x] Inspect current hourly scheduler, task persistence, DTOs, frontend mapping and v1 parity tests; record this proposed upgrade.
- [x] Confirm proposed defaults and scoped UI additions; proceed with workload-limited rollover.
- [x] Implement a pure V2 duration/capacity/horizon policy with a supplied clock/zone and focused offline fixtures, leaving V1 fixtures intact.
- [x] Add schema 5, preserve legacy payloads/receipts and implement validated estimates/preferences/interval persistence.
- [x] Extend DTOs, response schemas and OpenAPI; retain atomic revision/mutation protection and persist planning results for duplicate replay.
- [x] Integrate approved dialog/settings/calendar changes and truthful capacity feedback; preserve the unscheduled-list and completion rules.
- [x] Run backend checks, frontend lint/build/planner regressions and desktop/mobile screenshot verification; record results before marking this upgrade complete.

Required fixtures: twelve one-hour tasks rolling into week two at the proposed budget; mixed half-hour/90-minute work; contiguous-slot fragmentation; duration longer than budget; existing overlaps and over-capacity days; completed tasks and immutable history; same legacy finding key with distinct task IDs; disabled/enabled weekends; horizon overflow and unchanged future assignments; past ranges and current-day starts; DST/month/year boundaries; duration edits that invalidate an interval; preference changes without automatic movement; duplicates/concurrent revisions/rollback/restart; migration preserving archives and accounting; accurate half-hour display, overflow remaining on the left and future planned work staying off it.

Initial planning validation was documentation-only. Implementation now has 32 pure V2 scheduler tests, new API/migration cases, and existing persistence/restart/transport regressions running against isolated fixtures. Other agents' AI Fix and WordPress files remain untouched.

### Final upgrade verification and handoff

Settings-save follow-up: reproduced a `503 DATABASE_UNAVAILABLE` from the local backend even for a same-value preference PATCH. Read-only schema inspection found an early schema-5 database missing both planning receipt result columns. Schema 6 now adds only missing receipt columns and records the repair without rewriting task history, settings or prior receipts. Regression fixtures cover both missing columns and a single missing checksum column, duplicate replay, preserved migration dates and settings durability after restart. The browser regression now edits every setting, verifies failed-save retention/retry, and checks values after reopening/reloading. Existing schema-5 installation instructions above describe the original upgrade; the current backend initializes through schema 6.

Follow-up verification: full backend check passed typecheck/lint/build and 89 suites with 1,907 passing tests and one existing skip (`server/node_modules/.cache/smart-planner-settings-check.log`). Client lint and all ten planner browser scenarios passed (`client/node_modules/.cache/backend-lab-smoke/run-gKJ5NX`). The local application database was backed up to `server/node_modules/.cache/planner-before-schema6-1793652559835.sqlite` before applying schema 6; all planner headers/tasks/prior receipt records were compared unchanged across migration. A same-value settings PATCH against the running backend then returned 200, preserving the existing preference values. No other agent's backend process was stopped, no provider/AI/WordPress operations ran, and no commits were made.

- Backend `npm run check`: typecheck, lint, 89 suites / 1,892 passed / one existing skip, production build; zero failures. Log: `server/node_modules/.cache/smart-planner-v2-check.log`.
- Client `npm run lint` and `npm run build`: passed. The build retains a non-failing bundle-size warning (~505 kB main chunk).
- Client `npm run test:planner`: pure scheduling/source fixtures, API/session/replay/error tests, interval-layout checks and all ten offline browser scenarios passed. Browser artifacts: `client/node_modules/.cache/backend-lab-smoke/run-ne2clk` (27 screenshots).
- Browser coverage includes weekly/monthly calendars at 1440/768/390/320 widths, desktop/mobile dialogs, loading/saving/errors, business-switch races, completion/reload, weekend behavior, settings confirmation, rollover, oversized-task overflow and manual half-hour overlaps. Screenshot review checked the multiweek month, mobile interval rendering, settings and task guidance. Calendar card time ranges have their own compact line so titles remain visible. Long dialogs use their existing scroll treatment.
- API/migration fixtures cover duration/preference validation, immutable completed estimates/history, interval rollback, twelve one-hour tasks crossing weeks, overload/overflow, current-clock handling, durable planning receipt replay, concurrent revisions, corrupt results failing closed and byte-preserving legacy migration. Existing restart/isolation/source reconciliation fixtures also pass. Tests use temporary databases and offline evidence; no development database migration or external operation was run.
- New isolated implementation files: `server/src/modules/smart-planner/planner-scheduler-v2.ts`, three V2 scheduler/API/migration test files, `client/src/components/planner/PlannerSettingsDialog.tsx`, `client/src/services/plannerTiming.ts`, and its focused test script. Existing planner types, service, repository, DTOs, SQLite migration, API/session/hook, dialogs/calendar/page and browser fixtures were extended. README, DATABASE, PLAN and this tracker document the upgrade.
- Local use: restart the backend to apply schema 5, refresh the frontend, save Planning settings with an explicitly confirmed time zone, then run Auto Plan. Existing assignments never move automatically; unschedule selected tasks before redistributing them. A small backlog may still fit in week one. An oversized task stays on the left until its estimate or workload budget allows scheduling.
- Known scope: the existing Plan Completion (This Week) KPI retains its browser-local week anchor; automatic planning uses the confirmed planner time zone. Near cross-zone week boundaries those anchors can differ. No automatic localStorage import, bulk replanning, measured effort, task splitting or full-horizon spreading was added. No shared-file coordination blockers remain. No protected AI/WordPress changes, paid calls, commits or deployment were performed by this work.
