import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { createDemoBusiness, createSeedAudit } from "../src/fixtures/demo.js";
import { attachLighthouse } from "../src/integrations/lighthouse/evidence.js";
import { normalizeLighthouse } from "../src/integrations/lighthouse/normalize.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import { ReportStorageError } from "../src/reports/report.types.js";
import { pageSpeedFixture } from "./fixtures/pagespeed.js";
import type { FacebookReport } from "../src/integrations/facebook/types.js";

describe("durable audit report files", () => {
  let root: string;
  let directory: string;
  let store: FileReportStore;
  const business = createDemoBusiness();
  const newStore = (location: string) =>
    new FileReportStore(
      new ConfigService({
        REPORTS_DIR: location,
        PAGESPEED_API_KEY: "fixture-private-key",
      }),
    );

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "seo-spy-report-tests-"));
    directory = join(root, "reports");
    store = newStore(directory);
  });

  afterEach(async () => {
    const target = resolve(root);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("seo-spy-report-tests-")
    ) {
      throw new Error("Refusing cleanup outside the owned temporary directory");
    }
    await rm(target, { recursive: true, force: true });
  });

  it("publishes complete UTF-8 results and normalized Lighthouse data that survive a new store instance", async () => {
    const audit = createSeedAudit(business.id);
    const results = audit.results!;
    results.evidence[0].observed.excerpt =
      "Declaración española <script>untrusted()</script>";
    attachLighthouse(
      results,
      normalizeLighthouse(
        pageSpeedFixture(),
        "https://www.guzmantaxaccounting.com/",
        "mobile",
      ),
      audit.id,
    );
    const before = Date.now();
    const reference = await store.write(audit, business);
    const after = Date.now();
    expect(reference).toMatchObject({ reportId: audit.id, auditId: audit.id });
    expect(reference.downloadUrl).toContain(audit.id);
    expect(reference.generatedAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
    );
    expect(Date.parse(reference.generatedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(reference.generatedAt)).toBeLessThanOrEqual(after);
    expect(reference.fileName).toBe(
      `${reference.generatedAt.replace(/[:.]/g, "-")}_${audit.id}.json`,
    );
    const raw = await readFile(join(directory, reference.fileName), "utf8");
    expect(raw).toContain("Declaración española");
    expect(raw).not.toContain("fixture-private-key");
    expect(raw).not.toContain("PAGESPEED_API_KEY");
    const record = await newStore(directory).read(audit.id);
    const { results: _results, ...snapshot } = audit;
    void _results;
    expect(record).toEqual({
      schemaVersion: "seo-spy.audit-report.v1",
      reportId: audit.id,
      auditId: audit.id,
      generatedAt: reference.generatedAt,
      business,
      audit: snapshot,
      results,
    });
    expect(await newStore(directory).list(business.id)).toEqual([
      expect.objectContaining(reference),
    ]);
    expect(await newStore(directory).list("other-business")).toEqual([]);
  });

  it("keeps concurrent same-millisecond audits in separate UUID files and lists newest first", async () => {
    const audits = Array.from({ length: 12 }, () =>
      createSeedAudit(business.id),
    );
    const references = await Promise.all(
      audits.map((audit) => store.write(audit, business)),
    );
    expect(
      new Set(references.map((reference) => reference.fileName)).size,
    ).toBe(audits.length);
    expect(
      new Set(references.map((reference) => reference.reportId)).size,
    ).toBe(audits.length);
    expect(
      (await readdir(directory)).filter((file) => file.endsWith(".json")),
    ).toHaveLength(audits.length);
    const summaries = await newStore(directory).list(business.id);
    expect(summaries).toHaveLength(audits.length);
    const timestamps = summaries.map((summary) => summary.generatedAt);
    expect(timestamps).toEqual([...timestamps].sort().reverse());
    for (const reference of references) {
      expect(reference.fileName).toBe(
        `${reference.generatedAt.replace(/[:.]/g, "-")}_${reference.auditId}.json`,
      );
      expect(await store.read(reference.auditId)).toMatchObject({
        auditId: reference.auditId,
        generatedAt: reference.generatedAt,
      });
    }
  });

  it("archives domain fields without copying accidental runtime configuration properties", async () => {
    const audit = createSeedAudit(business.id);
    const extendedAudit = Object.assign(audit, {
      environment: { apiKey: "runtime-secret-marker" },
    });
    const extendedBusiness = Object.assign(
      { ...business },
      { config: { token: "business-secret-marker" } },
    );
    const reference = await store.write(extendedAudit, extendedBusiness);
    const raw = await readFile(join(directory, reference.fileName), "utf8");
    expect(raw).not.toContain("runtime-secret-marker");
    expect(raw).not.toContain("business-secret-marker");
    expect(await store.read(audit.id)).toMatchObject({
      audit: { id: audit.id },
      business: { id: business.id },
    });
  });

  it("rejects malformed Facebook data before publication and when reading a tampered archive", async () => {
    const invalid = createSeedAudit(business.id);
    invalid.scope = "facebook";
    invalid.scoringVersion = "facebook-v1";
    Object.assign(invalid.results!, {
      facebook: { pageId: "123", access_token: "secret-marker" },
    });
    await expect(store.write(invalid, business)).rejects.toMatchObject({
      code: "INVALID_REPORT",
    });
    expect(await store.read(invalid.id)).toBeNull();

    const valid = createSeedAudit(business.id);
    const reference = await store.write(valid, business);
    const file = join(directory, reference.fileName);
    const record = JSON.parse(await readFile(file, "utf8"));
    record.results.facebook = { pageId: "123" };
    await writeFile(file, JSON.stringify(record));
    await expect(newStore(directory).read(valid.id)).rejects.toMatchObject({
      code: "INVALID_REPORT",
    });
    await expect(newStore(directory).list(business.id)).rejects.toMatchObject({
      code: "INVALID_REPORT",
    });
  });

  it("preserves a partial Facebook report across restart and strips unexpected credentials", async () => {
    const audit = createSeedAudit(business.id);
    audit.scope = "facebook";
    audit.mode = "live";
    audit.scoringVersion = "facebook-v1";
    audit.status = "partial";
    audit.failure = {
      code: "FACEBOOK_INCOMPLETE",
      message: "Some data is unavailable.",
    };
    const at = audit.completedAt!;
    const facebook: FacebookReport = {
      provider: "facebook-graph",
      version: "facebook-v1",
      graphVersion: "v26.0",
      pageId: "12345",
      pageName: "Business Page",
      collectedAt: at,
      window: { since: at, until: at, requestedDays: 30 },
      profile: {
        name: { status: "available", value: "Business Page", collectedAt: at },
        hours: { status: "missing", value: null, collectedAt: at },
      },
      posts: {
        status: "available",
        items: [
          {
            id: "12345_6789",
            message: "A business update",
            createdTime: at,
            url: "https://www.facebook.com/12345/posts/6789",
          },
        ],
        truncated: false,
        collectedAt: at,
      },
      metrics: [
        {
          name: "page_follows",
          status: "available",
          period: "day",
          points: [{ endTime: at, value: 0 }],
          aggregation: "snapshot",
          total: null,
          collectedAt: at,
        },
      ],
      summary: {
        followersStart: 0,
        followersEnd: 0,
        followersChange: 0,
        latestPostAt: at,
        postsInWindow: 1,
        postsInWindowComplete: true,
      },
      coverage: {
        profileFieldsAvailable: 1,
        profileFieldsMissing: 1,
        profileFieldsUnavailable: 0,
        metricsAvailable: 1,
        metricsRequested: 1,
        postsLimit: 50,
      },
      limitations: ["Only authorized Page data is included."],
    };
    Object.assign(facebook, { access_token: "facebook-private-token" });
    Object.assign(facebook.posts.items[0], {
      access_token: "post-private-token",
    });
    audit.results = {
      evidence: [],
      findings: [],
      recommendations: [],
      scores: [
        {
          category: "social",
          value: null,
          maximum: 100,
          availability: "unavailable",
          scoringVersion: "facebook-v1",
        },
      ],
      facebook,
    };
    const reference = await store.write(audit, business);
    const raw = await readFile(join(directory, reference.fileName), "utf8");
    expect(raw).not.toContain("facebook-private-token");
    expect(raw).not.toContain("post-private-token");
    const restored = await newStore(directory).read(audit.id);
    expect(restored).toMatchObject({
      audit: {
        scope: "facebook",
        mode: "live",
        status: "partial",
        scoringVersion: "facebook-v1",
      },
      results: {
        facebook: {
          pageId: "12345",
          summary: { followersEnd: 0 },
          profile: { hours: { status: "missing", value: null } },
        },
        scores: [{ value: null }],
      },
    });
    expect(await newStore(directory).list(business.id)).toEqual([
      expect.objectContaining({
        auditId: audit.id,
        scope: "facebook",
        status: "partial",
      }),
    ]);
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".json")),
    ).toEqual([reference.fileName]);
    const tampered = JSON.parse(raw);
    tampered.results.facebook.access_token = "tampered-token";
    tampered.results.facebook.profile.name.access_token =
      "tampered-field-token";
    await writeFile(
      join(directory, reference.fileName),
      JSON.stringify(tampered),
    );
    const sanitizedRead = JSON.stringify(
      await newStore(directory).read(audit.id),
    );
    expect(sanitizedRead).not.toContain("tampered-token");
    expect(sanitizedRead).not.toContain("tampered-field-token");
  });

  it("preserves the first immutable snapshot across concurrent writes and restarts", async () => {
    const audit = createSeedAudit(business.id);
    const references = await Promise.all(
      Array.from({ length: 8 }, () => store.write(audit, business)),
    );
    expect(
      references.every(
        (reference) =>
          JSON.stringify(reference) === JSON.stringify(references[0]),
      ),
    ).toBe(true);
    const original = await readFile(
      join(directory, references[0].fileName),
      "utf8",
    );
    audit.warnings.push("Later mutation must not replace the archive");
    audit.results!.findings.length = 0;
    expect(await newStore(directory).write(audit, business)).toEqual(
      references[0],
    );
    expect(
      await readFile(join(directory, references[0].fileName), "utf8"),
    ).toBe(original);
    expect(await readdir(directory)).toEqual([references[0].fileName]);
  });

  it.each(["partial", "failed"] as const)(
    "archives %s status, failure, warnings and available results",
    async (status) => {
      const audit = createSeedAudit(business.id);
      audit.status = status;
      audit.stage = status === "failed" ? "failed" : "complete";
      audit.failure = {
        code: "PROVIDER_UNAVAILABLE",
        message: "Measurement unavailable.",
      };
      audit.warnings.push("Some checks could not complete.");
      if (status === "failed") audit.results = null;
      await store.write(audit, business);
      expect(await newStore(directory).read(audit.id)).toMatchObject({
        audit: { status, failure: audit.failure, warnings: audit.warnings },
        results: audit.results,
      });
    },
  );

  it("returns null for a missing audit and ignores temporary and unrelated files", async () => {
    await mkdir(directory);
    await writeFile(join(directory, "unfinished.tmp"), "{");
    await writeFile(join(directory, "unrelated.json"), "{}");
    expect(await store.read(randomUUID())).toBeNull();
    expect(await store.list(business.id)).toEqual([]);
  });

  it.each(["../outside", "..\\outside", "/absolute", "not-a-uuid", ""])(
    "rejects unsafe audit identifier %j",
    async (id) => {
      await expect(store.read(id)).rejects.toBeInstanceOf(ReportStorageError);
      const audit = createSeedAudit(business.id);
      audit.id = id;
      await expect(store.write(audit, business)).rejects.toBeInstanceOf(
        ReportStorageError,
      );
    },
  );

  it("exposes safe storage errors when the configured directory is a regular file", async () => {
    const blocked = join(root, "private-location");
    await writeFile(blocked, "fixture-private-key");
    try {
      await newStore(blocked).write(createSeedAudit(business.id), business);
      throw new Error("Expected report persistence to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ReportStorageError);
      const safeError = error as ReportStorageError;
      expect(typeof safeError.code).toBe("string");
      expect(safeError.message).not.toContain(root);
      expect(safeError.message).not.toContain("fixture-private-key");
    }
  });

  (process.platform === "win32" ? it.skip : it)(
    "does not follow an archive symlink outside the report directory",
    async () => {
      const audit = createSeedAudit(business.id);
      const reference = await store.write(audit, business);
      const reportPath = join(directory, reference.fileName);
      const outside = join(root, "outside.json");
      await writeFile(outside, await readFile(reportPath));
      await rm(reportPath);
      try {
        await symlink(outside, reportPath, "file");
      } catch (error) {
        if (
          ["EPERM", "EACCES", "ENOSYS"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        ) {
          console.warn(
            "Skipping symlink escape assertion: this platform does not permit file symlinks.",
          );
          return;
        }
        throw error;
      }
      await expect(store.read(audit.id)).rejects.toBeInstanceOf(
        ReportStorageError,
      );
      await expect(store.list(business.id)).rejects.toBeInstanceOf(
        ReportStorageError,
      );
    },
  );
});
