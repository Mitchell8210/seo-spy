import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AppDatabase, type ArtifactKind } from "../src/persistence/sqlite/app-database.js";
import { WordPressActionsStore } from "../src/modules/wordpress/wordpress-actions.store.js";

const timestamp = "2026-10-31T12:00:00.000Z";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function proposal(id = randomUUID()) {
  // Deliberately preserve nonalphabetical field order, as the existing exact-hash
  // approval format hashes serialized original before-state and changes.
  const original = { version: "wordpress-proposal-v1", id, businessId: "example", actor: "operator-identity", siteUrl: "https://example.com", resource: "media", resourceId: 7, createdAt: timestamp, expiresAt: "2026-10-31T12:15:00.000Z", modified: "2026-10-30T20:00:00", before: { altText: "", title: "Stored image" }, changes: { altText: "Approved alternative", title: "Reviewed image" } };
  return { ...original, hash: digest(original) };
}

describe("SQLite adoption preserves WordPress operation and retained-lock history", () => {
  let directory: string;
  let archive: string;
  let config: ConfigService;
  let database: AppDatabase;
  let store: WordPressActionsStore;
  const open = () => { database = new AppDatabase(config); store = new WordPressActionsStore(config, database); };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-sqlite-wp-actions-"));
    archive = join(directory, "actions");
    config = new ConfigService({ DATABASE_PATH: join(directory, "application.sqlite"), WORDPRESS_ACTIONS_DIR: archive });
    open();
  });
  afterEach(async () => {
    database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-sqlite-wp-actions-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("persists proposal/start/unknown outcome/verification records across restart without source JSON", async () => {
    const reviewed = proposal();
    const records = {
      proposal: reviewed,
      started: { businessId: "example", actor: "operator-identity", proposalHash: reviewed.hash, startedAt: timestamp },
      outcome: { id: reviewed.id, businessId: "example", status: "outcome_unknown", verification: "inconclusive", completedAt: timestamp },
      verification: { id: reviewed.id, businessId: "example", status: "inconclusive", proposalId: reviewed.id, completedAt: timestamp },
    };
    for (const [kind, data] of Object.entries(records)) {
      expect(await store.create(reviewed.id, kind, data)).toBe(true);
      expect(database.readArtifact(`wordpress-${kind}` as ArtifactKind, reviewed.id)?.payload).toEqual(data);
    }
    database.close();
    for (const kind of Object.keys(records)) await unlink(join(archive, `${reviewed.id}.${kind}.json`));
    open();
    for (const [kind, data] of Object.entries(records)) expect(await store.read(reviewed.id, kind)).toEqual(data);
    expect(await store.create(reviewed.id, "started", records.started)).toBe(false);
    expect(await store.create(reviewed.id, "outcome", { ...records.outcome, status: "applied" })).toBe(false);
    expect(await readdir(archive)).toEqual([]);
  });

  it("preserves exact raw proposal property order and approval digest", async () => {
    const reviewed = proposal();
    await store.create(reviewed.id, "proposal", reviewed);
    database.close();
    await unlink(join(archive, `${reviewed.id}.proposal.json`));
    open();
    const saved = await store.read(reviewed.id, "proposal") as ReturnType<typeof proposal>;
    expect(JSON.stringify(saved)).toBe(JSON.stringify(reviewed));
    const { hash, ...original } = saved;
    expect(digest(original)).toBe(hash);
    expect(Object.keys(saved.changes)).toEqual(["altText", "title"]);
    expect(saved.createdAt).toBe(timestamp);
    expect(saved.modified).toBe(reviewed.modified);
  });

  it("imports existing history idempotently without rewriting bytes or stored timestamps", async () => {
    const reviewed = proposal();
    await mkdir(archive);
    const records = {
      proposal: reviewed,
      started: { businessId: "example", actor: "operator-identity", proposalHash: reviewed.hash, startedAt: timestamp },
      outcome: { id: reviewed.id, businessId: "example", status: "outcome_unknown", completedAt: timestamp },
    };
    for (const [kind, value] of Object.entries(records)) await writeFile(join(archive, `${reviewed.id}.${kind}.json`), JSON.stringify(value, null, 1) + "\n");
    expect(await store.importLegacy()).toEqual({ imported: 3, existing: 0 });
    expect(await store.importLegacy()).toEqual({ imported: 0, existing: 3 });
    for (const [kind, value] of Object.entries(records)) {
      expect(await readFile(join(archive, `${reviewed.id}.${kind}.json`), "utf8")).toBe(JSON.stringify(value, null, 1) + "\n");
      expect(database.readArtifact(`wordpress-${kind}` as ArtifactKind, reviewed.id)?.createdAt).toBe(timestamp);
      expect(await store.read(reviewed.id, kind)).toEqual(value);
    }
  });

  it("retains target locks and unknown reservations independently from imported SQL records", async () => {
    const reviewed = proposal();
    const targetKey = digest({ siteUrl: "https://example.com", resource: "media", id: 7 });
    const release = await store.reserveTarget(targetKey);
    expect(release).not.toBeNull();
    const started = { businessId: "example", actor: "operator-identity", startedAt: timestamp };
    const outcome = { id: reviewed.id, businessId: "example", status: "outcome_unknown", completedAt: timestamp };
    await writeFile(join(archive, `${reviewed.id}.started.json`), JSON.stringify(started));
    await writeFile(join(archive, `${reviewed.id}.outcome.json`), JSON.stringify(outcome));
    await store.importLegacy();
    database.close();
    await unlink(join(archive, `${reviewed.id}.started.json`));
    await unlink(join(archive, `${reviewed.id}.outcome.json`));
    open();
    expect(await store.reserveTarget(targetKey)).toBeNull();
    expect(await store.create(reviewed.id, "started", started)).toBe(false);
    expect(await store.read(reviewed.id, "outcome")).toEqual(outcome);
    expect(await readdir(archive)).toEqual([`${targetKey}.target.lock`]);
    await release!();
  });

  it("does not claim a saved operation when SQL publication fails or use JSON to bypass an unavailable database", async () => {
    const reviewed = proposal();
    const fail = jest.spyOn(database, "insertArtifact").mockImplementationOnce(() => { throw new Error("private-database-path"); });
    await expect(store.create(reviewed.id, "proposal", reviewed)).rejects.toMatchObject({ status: 503 });
    expect(database.readArtifact("wordpress-proposal", reviewed.id)).toBeNull();
    // A complete export can be explicitly adopted once database access works;
    // the rejected publication was never represented as a saved SQL operation.
    expect(await store.read(reviewed.id, "proposal")).toEqual(reviewed);
    expect(fail).toHaveBeenCalledTimes(2);
    jest.spyOn(database, "readArtifact").mockImplementation(() => { throw new Error("private-database-path"); });
    await expect(store.read(reviewed.id, "proposal")).rejects.toMatchObject({ status: 503 });
    await expect(store.create(randomUUID(), "started", { businessId: "example", startedAt: timestamp })).rejects.toMatchObject({ status: 503 });
  });

  it("rejects invalid IDs, kinds, business scope and malformed legacy data", async () => {
    await expect(store.create("../private", "proposal", proposal())).rejects.toMatchObject({ status: 503 });
    await expect(store.read(randomUUID(), "unsupported")).rejects.toMatchObject({ status: 503 });
    const missingBusiness = randomUUID();
    await expect(store.create(missingBusiness, "started", { startedAt: timestamp })).rejects.toMatchObject({ status: 503 });
    expect(database.readArtifact("wordpress-started", missingBusiness)).toBeNull();
    await mkdir(archive, { recursive: true });
    const malformedId = randomUUID();
    await writeFile(join(archive, `${malformedId}.outcome.json`), "{invalid");
    await expect(store.read(malformedId, "outcome")).rejects.toMatchObject({ status: 503 });
    expect(database.readArtifact("wordpress-outcome", malformedId)).toBeNull();
  });

  it("rejects a junction legacy archive for publication, import and direct missing-primary reads", async () => {
    const actual = join(directory, "actual");
    await mkdir(actual);
    const reviewed = proposal();
    await writeFile(join(actual, `${reviewed.id}.proposal.json`), JSON.stringify(reviewed));
    await symlink(actual, archive, process.platform === "win32" ? "junction" : "dir");
    await expect(store.create(randomUUID(), "started", { businessId: "example", startedAt: timestamp })).rejects.toMatchObject({ status: 503 });
    await expect(store.importLegacy()).rejects.toMatchObject({ status: 503 });
    await expect(store.read(reviewed.id, "proposal")).rejects.toMatchObject({ status: 503 });
    expect(database.readArtifact("wordpress-proposal", reviewed.id)).toBeNull();
  });
});
