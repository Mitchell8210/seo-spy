# WordPress media alt-text pilot

This local operator workflow supports one narrow test: change a media attachment's `altText` through the existing proposal/Apply API. It does not configure staging, enable writes, create application-user authorization, run Rank Math audits, restore values automatically, or prove an edit appeared on a public page. The script retains its wordpress-staging.mjs filename, but can target staging or a separately authorized live pilot. A live pilot does not establish staging isolation. Adding this script has not performed any live edit.

The user selected the existing Guzman website for a simple image-alt-text pilot. The exact target image, before/after text and proposal must still be reviewed before Apply. Before a test, confirm the intended registered business/website binding and its server-side credentials. Do not point production credentials at an unrelated installation. Confirm the exact image is informative and identify where it appears; an empty alternative can be correct for decorative images. Keep the backend on loopback and writes disabled while preparing the change. The `--target-confirmed` flag records the operator's explicit target choice; it does not prove staging isolation or business ownership.

The shell running the script needs `WORDPRESS_OPERATOR_KEY` supplied securely through its environment. The script does not load `.env` or accept tokens/passwords as CLI arguments. The backend retains the WordPress username/application password. Use an already running, freshly built backend with the intended installation binding. All examples below use placeholders and are not approval to change any actual site.

## Preview and review

Create a UTF-8 file containing the proposed exact alt text. Its contents, including any trailing newline, are used unchanged. Keep it at 2000 characters or fewer. From `server/`:

```powershell
node scripts/wordpress-staging.mjs --mode=preview --api-origin=http://127.0.0.1:3001 --business-id=registered-business --site-url=https://selected.example.com --resource-id=123 --alt-text-file=./approved-alt-text.txt --target-confirmed
```

The script verifies the connection's business and exact installation before creating a proposal. It prints only the selected media target, original/proposed alt text, modification timestamp, ID, hash and expiry. Preview never calls Apply. Review the exact diff with the approving user, including the target and where the image appears. A proposal expires after 15 minutes; any change requires a new proposal and approval. This workflow excludes all other media fields and page/post edits.

## Apply the approved proposal

After explicit user approval of that exact proposal, enable `WORDPRESS_WRITES_ENABLED=true` only in the intended backend process. Use the saved proposal ID/hash, without an alt-text file or new patch:

```powershell
node scripts/wordpress-staging.mjs --mode=apply --api-origin=http://127.0.0.1:3001 --business-id=registered-business --site-url=https://selected.example.com --proposal-id=REVIEWED-UUID-V4 --proposal-hash=REVIEWED-64-CHARACTER-HASH --confirmed --target-confirmed
```

Apply rereads and checks the proposal, target binding, exact hash, expiry and write gate. It sends at most one Apply request and then reads the persisted receipt. It never creates a replacement proposal or retries Apply. If the saved proposal has already started or has an outcome, the script only prints its receipt. The backend also provides persisted single-execution reservations and retained target locks. Offline tests cover this behavior; actual target verification remains a separately recorded live result.

Immediately restore `WORDPRESS_WRITES_ENABLED=false` and verify `/connection` reports `writesEnabled: false`. The script never changes the write gate itself. A receipt's `applied` state and `verified_stored_fields` prove different things; neither proves public rendering, rankings, performance or SEO improvement. Elementor widgets and existing image markup can retain different alt text.

## Inspect, uncertainty and restoration

Inspection uses GETs only and works while writes are disabled:

```powershell
node scripts/wordpress-staging.mjs --mode=inspect --api-origin=http://127.0.0.1:3001 --business-id=registered-business --site-url=https://selected.example.com --proposal-id=REVIEWED-UUID-V4 --target-confirmed
```

On timeout, a lost response, `outcome_unknown`, failed receipt inspection, or an execution marker without an outcome: disable writes and inspect the original operation plus fresh remote state. Do not issue another Apply or create another proposal as an automatic retry. The script attempts at most one read-only receipt inspection after an Apply error. Exit code 2 indicates an uncertain or failed execution result; a caught validation/transport failure exits 1. Operators must still inspect the receipt, since an exit code cannot prove no remote mutation occurred.

Preserve all operation records. Reconcile a retained lock through the trusted local recovery procedure in [the module documentation](WORDPRESS_MODULE.md#uncertain-outcomes-and-local-recovery), stopping relevant workers and removing only the identified stale lock after recording reconciliation. No automated unlock or rollback exists. To restore the original alt text, create a new preview with that exact value, review the fresh before-state, obtain separate approval and Apply that new proposal. Never overwrite a later third-party edit.

Preflight comparison is not an atomic WordPress compare-and-swap: another editor can change content between the preflight GET and the write. Local file reservations prevent duplicate dispatch through this module; they do not provide distributed transactional concurrency. Shared/public execution still requires application identity, business/asset authorization and stronger persistence as described in [the broader plan](AI_AGENT_INTEGRATION_PLAN.md).

