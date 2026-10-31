import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { WordPressReportsStore } from "../src/modules/wordpress/wordpress-reports.store.js";
import type { WordPressEvidenceReport } from "../src/modules/wordpress/wordpress-report.types.js";

function fixture(overrides: Partial<WordPressEvidenceReport> = {}): WordPressEvidenceReport {
  const date = "2026-10-31T12:00:00.000Z";
  return {
    schemaVersion: "seo-spy.wordpress-evidence.v1", id: randomUUID(), businessId: "example", siteUrl: "https://example.com",
    startedAt: date, generatedAt: date, availability: "unavailable", sampleSize: 20,
    content: (["pages", "posts", "media"] as const).map(resource => ({ resource, collectedAt: date, availability: "unavailable", items: [], limitations: [] })),
    rankMath: (["pages", "posts"] as const).map(resource => ({ resource, evidence: null, limitations: [] })),
    scoring: { seoSpyScore: null, policyVersion: null, storedScoreFreshness: "unknown" }, limitations: [], ...overrides,
  };
}

describe("immutable WordPress evidence archive", () => {
  let directory: string;
  let archive: string;
  let store: WordPressReportsStore;
  const createStore = (path: string) => new WordPressReportsStore(new ConfigService({ WORDPRESS_REPORTS_DIR: path }));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-wordpress-reports-"));
    archive = join(directory, "archive");
    store = createStore(archive);
  });

  afterEach(async () => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-wordpress-reports-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("returns absent results without creating an archive", async () => {
    expect(await store.read(randomUUID())).toBeNull();
    expect(await store.list("example", "https://example.com", 10)).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("preserves a schema-valid report across store recreation without changing source values", async () => {
    const report = fixture();
    report.content[0].items.push({ id: 7, title: "Título español", link: "https://example.com/page", modifiedAt: "2026-10-30T00:00:00", altText: null });
    await store.publish(report);
    expect(await createStore(archive).read(report.id)).toEqual(report);
    expect(await readdir(archive)).toEqual([`${report.id}.json`]);
  });

  it("allows only one concurrent publication for an ID and leaves no partial publication", async () => {
    const report = fixture();
    const changed = fixture({ id: report.id, availability: "partial" });
    const results = await Promise.allSettled([store.publish(report), store.publish(changed)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const stored = await store.read(report.id);
    expect([report, changed]).toContainEqual(stored);
    expect(await readdir(archive)).toEqual([`${report.id}.json`]);
    const previous = await readFile(join(archive, `${report.id}.json`), "utf8");
    await expect(store.publish(fixture({ id: report.id }))).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(archive, `${report.id}.json`), "utf8")).toBe(previous);
  });

  it("limits history, orders by collection completion and isolates business and installation", async () => {
    const first = fixture({ generatedAt: "2026-10-31T12:01:00.000Z" });
    const latest = fixture({ generatedAt: "2026-10-31T12:03:00.000Z" });
    const middle = fixture({ generatedAt: "2026-10-31T12:02:00.000Z" });
    for (const report of [first, latest, middle, fixture({ businessId: "other" }), fixture({ siteUrl: "https://other.example" })]) await store.publish(report);
    expect((await store.list("example", "https://example.com", 2)).map(report => report.id)).toEqual([latest.id, middle.id]);
    expect(await store.list("absent", "https://example.com", 2)).toEqual([]);
    await expect(store.list("example", "https://example.com", 0)).rejects.toMatchObject({ status: 503 });
    await expect(store.list("example", "https://example.com", 101)).rejects.toMatchObject({ status: 503 });
  });

  it("rejects path traversal and invalid reports before writing", async () => {
    await expect(store.read("../private-file")).rejects.toMatchObject({ status: 503 });
    await expect(store.publish(fixture({ id: "../private-file" }))).rejects.toMatchObject({ status: 503 });
    await expect(store.publish(fixture({ schemaVersion: "invalid" as WordPressEvidenceReport["schemaVersion"] }))).rejects.toMatchObject({ status: 503 });
    expect(await readdir(directory)).toEqual([]);
  });

  it("fails closed on corrupt JSON, schema failures and filename/record ID mismatches", async () => {
    await mkdir(archive);
    const id = randomUUID();
    const path = join(archive, `${id}.json`);
    for (const contents of ["{malformed", JSON.stringify({ id }), JSON.stringify(fixture())]) {
      await writeFile(path, contents);
      await expect(store.read(id)).rejects.toMatchObject({ status: 503 });
      await expect(store.list("example", "https://example.com", 10)).rejects.toMatchObject({ status: 503 });
    }
  });

  it("rejects oversized reports without reading their entire contents", async () => {
    await mkdir(archive);
    const id = randomUUID();
    const path = join(archive, `${id}.json`);
    await writeFile(path, "{}");
    await truncate(path, 8 * 1024 * 1024 + 1);
    await expect(store.read(id)).rejects.toMatchObject({ status: 503 });
  });

  it("rejects an archive directory replaced by a junction or symbolic link", async () => {
    const actual = join(directory, "actual");
    await mkdir(actual);
    await symlink(actual, archive, process.platform === "win32" ? "junction" : "dir");
    await expect(store.read(randomUUID())).rejects.toMatchObject({ status: 503 });
    await expect(store.list("example", "https://example.com", 1)).rejects.toMatchObject({ status: 503 });
    await expect(store.publish(fixture())).rejects.toMatchObject({ status: 503 });
    expect(await readdir(actual)).toEqual([]);
  });

  it("rejects directories masquerading as report files without leaking internal paths", async () => {
    await mkdir(archive);
    const id = randomUUID();
    await mkdir(join(archive, `${id}.json`));
    try {
      await store.read(id);
      throw new Error("Expected unsafe archive rejection");
    } catch (error) {
      expect(error).toMatchObject({ status: 503 });
      expect(String(error)).not.toContain(directory);
    }
  });
});
