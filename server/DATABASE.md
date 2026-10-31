# SQLite application database

Decision: SQLite is SEO Spy's application database, replacing the earlier PostgreSQL plan. It fits the current local, single-server application without requiring a database service. SQLite's [deployment guidance](https://www.sqlite.org/whentouse.html) supports this use; revisit the architecture if the product later needs multiple application servers sharing a high-write workload. That is a future capacity decision, not a planned PostgreSQL migration.

## What persists

`DATABASE_PATH` defaults to `reports/seo-spy.sqlite`, relative to `server/`. Node 24's built-in `node:sqlite` is used with prepared statements, foreign keys, immediate transactions, full synchronization and a five-second busy timeout. The primary database uses rollback journaling (`DELETE`); no ORM, database server, Redis or new dependency is required. `:memory:` is allowed only in tests. Business and audit services use the existing repository interfaces with SQLite implementations; memory repositories remain fixtures only.

| Table | Stored data |
| --- | --- |
| `schema_migrations` | Schema version and migration timestamp |
| `businesses`, `connections` | Registered identities, connection metadata and original creation dates; no credentials |
| `audits` | Audit IDs/business/scope, queued/running/terminal status, stage, UTC timestamps, revision, report reference and full results |
| `findings`, `suggestions` | Business/audit-linked findings and recommendations, statuses, timestamps and content |
| `artifacts` | Immutable audit/WordPress/Muse reports and WordPress proposal/start/outcome/verification receipts, with business/date indexes and payload checksums |

Structured fields used for history/status lookup are indexed relational columns. Versioned provider/evidence/report bodies remain JSON payloads within SQLite so existing contracts and original observations survive without reshaping their meaning. Suggestions are also normalized for future queries. Viewing a record never runs collection or a model call.

Audit status/results and the latest usable Website result survive process restart. Failed/new attempts do not erase prior results. Facebook audit records persist in their own channel; they do not become the Website dashboard's latest audit or block a Website investigation. Atomic active-audit uniqueness is enforced per business and channel across connections. Live collection still occurs in the existing process, not in a durable background queue.

## History adoption and exports

After building, adopt existing archives with:

```powershell
node scripts/migrate-sqlite.mjs --confirmed
```

This is an additive local operation. It validates existing audit, WordPress evidence, Muse analysis and action receipts; imports missing immutable artifacts; registers only missing businesses; and persists original audit timestamps, statuses and recommendations. Existing registered business identities and newer runtime audit state are never replaced with archive snapshots. The process makes no external request, enables no write/model gate, and compares the protected credit-ledger files before/after. Invalid legacy records fail closed; committed imports remain valid and a corrected import can be rerun idempotently.

Original JSON files are preserved. New reports continue producing immutable JSON compatibility exports and commit SQLite before claiming successful publication; existing integrations still receive the same file-name/download references. These exports are not the authoritative read source once imported. SQLite history/cache remains readable after an export is removed or damaged. Unseen corrupt legacy archives remain errors, rather than becoming invented empty results. A file published immediately before a failed DB commit can be safely adopted on a later import; the failed write does not claim success.

October 31 adoption imported 12 audit reports/audits, three WordPress evidence reports, one Muse analysis and three WordPress operation records. No audit was left queued/running in the imported runtime state. Archive contents and the AI credit-ledger files were preserved, with zero external requests. There is no source-history deletion or overwrite step.

A second application process reran adoption with zero new inserts and the same existing counts, confirming idempotency. The mock API harness then reused the same persisted analysis ID from SQLite across restart, with zero external requests, real calls or charged micros. Final offline verification passed 33 suites, 550 tests and one skipped, plus typecheck, lint and production build.

## Interrupted audits

Persisting a queued/running status does not automatically resume its work. This prevents an ordinary restart or report read from repeating external collection, using model credits or applying a change. A pending audit retains the business/channel reservation until an operator reconciles it.

Stop the original workers, inspect the exact persisted audit, then explicitly close it through:

```powershell
node scripts/migrate-sqlite.mjs --confirmed --recover-audit=AUDIT_UUID --workers-stopped
```

If its terminal report was already committed, recovery adopts that outcome. Otherwise it preserves collected partial facts, records `SERVER_INTERRUPTED`, saves a terminal failure report and releases the pending state. It does not replay work. Repeating recovery on a terminal audit is inert. `--workers-stopped` is an operator assertion; the tool is not a distributed lease manager. Do not use it while an original worker is still active.

The browser's Facebook progress endpoint still has session-scoped in-memory progress/outcome caches. Its durable audit/report facts survive restart, but old browser progress is not reconstructed and jobs are never automatically resumed. Application authentication and shared/public ownership controls remain separate work.

## Protected state kept separate

- `AI_USAGE_DB` remains `reports/ai-usage.sqlite`, preserving all exact approvals, spent/reserved amounts, unknown outcomes and limits. The primary database refuses that same path or inode. Adopting/replacing the application database cannot open a fresh spending budget. All [credit protection rules](AI_USAGE_RULES.md) remain in force and mock mode stays enabled.
- WordPress target-lock files remain intact; SQLite stores the operation records, but migration never removes an unknown execution marker or unlocks/replays a target. File-first exclusive safety markers plus SQL publication preserve fail-closed behavior while older local processes may still use file locks. Existing action approval/hash rules do not change.
- Encrypted Facebook credentials/browser sessions remain in their separate protected credential store. Private keys and passwords remain server configuration, not report/database payloads.

## Backup and operation

Both database files, initialized markers, original exports and encrypted credential state are ignored by Git. Keep protected local backups. For a simple consistent backup, stop the backend and all maintenance tools, then copy the application database and `.initialized` marker along with its related JSON exports. Back up the AI ledger separately with its initialized marker; if it is open, its WAL/SHM files are part of its state and must not be discarded. Restore only consistent snapshots. Do not restore an old credit ledger to obtain unused budget; reconcile provider usage first.

Schema migrations run transactionally and preserve existing rows. Unknown schema versions, corruption, unsafe file links and a missing initialized database fail closed instead of creating a silent empty replacement. No reset/drop/auto-clean command exists. The registered seed is inserted once and never refreshed over persisted data; its old simulated audit timestamp cannot pretend to be a fresh measurement after restart.

Restart existing backend processes after adopting these changes so they load SQLite-backed repositories. Read/write storage APIs retain their routes and payloads; the frontend presentation is unchanged. No Meta/WordPress request is needed for migration, recovery, backups or validation. Offline tests use isolated memory/temp databases, including restart, history, concurrency, imports, duplicate prevention, corruption and recovery cases.
