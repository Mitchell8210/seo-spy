import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { MetaMuseProvider } from "../src/integrations/ai/meta-muse.provider.js";
import { WebsiteCollector } from "../src/integrations/website/collector.js";
import { WordPressClient } from "../src/integrations/wordpress/wordpress.client.js";
import { AssessmentEditingService } from "../src/modules/assessments/assessment-editing.service.js";
import { WordPressActionsStore } from "../src/modules/wordpress/wordpress-actions.store.js";
import { WordPressMuseStore } from "../src/modules/wordpress/wordpress-muse.store.js";
import { WordPressMuseService } from "../src/modules/wordpress/wordpress-muse.service.js";
import type { WordPressEvidenceReport } from "../src/modules/wordpress/wordpress-report.types.js";
import type { WordPressReportsService } from "../src/modules/wordpress/wordpress-reports.service.js";
import { WordPressService } from "../src/modules/wordpress/wordpress.service.js";
import { WordPressVerificationService } from "../src/modules/wordpress/wordpress-verification.service.js";
import type { BusinessRepository } from "../src/persistence/repositories.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";

const businessId = "example";
const actor = "trusted-local-operator-identity";
const timestamp = "2026-10-31T12:00:00.000Z";
const approvedAlt = "The operator-reviewed description of the informative team image";

function sourceReport(): WordPressEvidenceReport {
  return {
    schemaVersion: "seo-spy.wordpress-evidence.v1", collectionPolicyVersion: "published-unprotected-v1",
    id: randomUUID(), businessId, siteUrl: "https://example.com", startedAt: timestamp, generatedAt: timestamp,
    availability: "partial", sampleSize: 20,
    content: (["pages", "posts", "media"] as const).map(resource => ({ resource, collectedAt: timestamp, availability: "available",
      items: (resource === "media" ? [9] : resource === "pages" ? [7, 8] : [11, 12]).map(id => ({ id, title: "Published fixture", link: "https://example.com/public/", modifiedAt: "2026-10-30T12:00:00", altText: resource === "media" ? "" : null })), limitations: ["Bounded sample."] })),
    rankMath: (["pages", "posts"] as const).map(resource => ({ resource, evidence: null, limitations: ["Not available."] })),
    scoring: { seoSpyScore: null, policyVersion: null, storedScoreFreshness: "unknown" }, limitations: ["Public rendering unverified."],
  };
}

describe("mock recommendation to reviewed WordPress media alternative workflow (offline)", () => {
  let directory: string;
  let settings: Record<string, unknown>;
  let config: ConfigService;
  let database: AppDatabase;
  let store: WordPressActionsStore;
  let muse: WordPressMuseService;
  let wordpress: WordPressService;
  let editing: AssessmentEditingService;
  let verification: WordPressVerificationService;
  let report: WordPressEvidenceReport;
  let analysisId: string;
  let recommendationId: string;
  let remoteAlt: string;
  let modified: string;
  let htmlAlt: string;
  let wire: ReturnType<typeof jest.fn<WordPressClient["request"]>>;
  let generate: ReturnType<typeof jest.fn<MetaMuseProvider["generate"]>>;
  let collect: ReturnType<typeof jest.fn<WebsiteCollector["collect"]>>;
  const writes = () => wire.mock.calls.filter(call => call[1] === "POST");
  const input = (altText = approvedAlt) => ({ reportId: report.id, analysisId, recommendationId, altText });

  const open = () => {
    database = new AppDatabase(config);
    store = new WordPressActionsStore(config, database);
    const businesses: BusinessRepository = { findById: async id => id === businessId ? { id, name: "Example", website: "https://example.com", createdAt: timestamp } : null, connections: async () => [] };
    wordpress = new WordPressService(config, { request: wire } as unknown as WordPressClient, store, businesses);
    const reports = { read: async (business: string, id: string) => {
      if (business !== businessId || id !== report.id) throw new NotFoundException();
      return structuredClone(report);
    } } as unknown as WordPressReportsService;
    muse = new WordPressMuseService(reports, { generate } as unknown as MetaMuseProvider, new WordPressMuseStore(config, database), config);
    editing = new AssessmentEditingService(muse, wordpress);
    verification = new WordPressVerificationService(wordpress, store, { collect } as unknown as WebsiteCollector);
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-assessment-edit-"));
    settings = { NODE_ENV: "test", DATABASE_PATH: join(directory, "application.sqlite"), AI_USAGE_DB: join(directory, "protected-ai.sqlite"),
      WORDPRESS_ACTIONS_DIR: join(directory, "actions"), WORDPRESS_MUSE_DIR: join(directory, "muse"), WORDPRESS_BUSINESS_ID: businessId,
      WORDPRESS_SITE_URL: "https://example.com", WORDPRESS_USERNAME: "private-fixture-user", WORDPRESS_APPLICATION_PASSWORD: "private-fixture-password",
      WORDPRESS_WRITES_ENABLED: false, MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false };
    config = new ConfigService(settings);
    report = sourceReport(); remoteAlt = ""; modified = "2026-10-30T12:00:00"; htmlAlt = approvedAlt;
    generate = jest.fn<MetaMuseProvider["generate"]>().mockRejectedValue(new Error("Real model generation is prohibited."));
    wire = jest.fn<WordPressClient["request"]>().mockImplementation(async (_connection, method, path, body) => {
      if (path === "/wp-json/wp/v2/media/9?context=edit" || method === "POST" && path === "/wp-json/wp/v2/media/9") {
        if (method === "POST") { remoteAlt = (body as Record<string, unknown>).alt_text as string; modified = "2026-10-31T12:01:00"; }
        return { id: 9, type: "attachment", status: "inherit", modified_gmt: modified, alt_text: remoteAlt, source_url: "https://example.com/uploads/team.jpg" };
      }
      if (method === "GET" && path === "/wp-json/wp/v2/pages/7?context=edit") return { id: 7, status: "publish", link: "https://example.com/public/" };
      throw new Error("Unexpected fixture request.");
    });
    collect = jest.fn<WebsiteCollector["collect"]>().mockImplementation(async url => {
      const body = Buffer.from(`<img class="wp-image-9" src="/uploads/team.jpg" alt="${htmlAlt}">`);
      return { requestedUrl: url, finalUrl: url, collectedAt: timestamp, status: 200, contentType: "text/html; charset=utf-8", robots: "", bytes: body.length, redirects: [], body };
    });
    open();
    const analysis = await muse.create(businessId, report.id);
    analysisId = analysis.id;
    recommendationId = analysis.output.recommendations.find(item => item.resource === "media")!.id;
  });
  afterEach(async () => {
    database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-assessment-edit-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("includes a cited media review while preserving the bounded mock page example", async () => {
    const analysis = await muse.read(businessId, report.id, analysisId);
    expect(analysis).toMatchObject({ isMock: true, provider: "mock-fixture", fixtureVersion: "muse-development-fixtures-v2", usage: { inputTokens: 0, outputTokens: 0 } });
    expect(analysis.output.observations).toHaveLength(3);
    expect(analysis.output.recommendations.map(item => item.resource)).toEqual(["pages", "media"]);
    expect(analysis.output.recommendations[1]).toMatchObject({ targetContentId: 9, capabilityId: "wordpress.media.propose-update", evidenceIds: [`${report.id}:wordpress:media:9:content`] });
    expect(wire).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });

  it("prepares an exact operator-authored patch with one fresh read and no approval, write, model or public collection", async () => {
    const result = await editing.prepareMediaAlt(businessId, actor, input());
    expect(result).toMatchObject({ schemaVersion: "seo-spy.assessment-edit-preview.v1", businessId, kind: "wordpress-media-alt",
      origin: { reportId: report.id, analysisId, recommendationId, isMock: true, generationMode: "mock", provider: "mock-fixture" },
      proposal: { resource: "media", resourceId: 9, before: { altText: "" }, changes: { altText: approvedAlt } } });
    expect(result.nextSteps.apply).toMatchObject({ confirmed: true, proposalHash: result.proposal.hash });
    expect(wire).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
    expect(collect).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    expect(database.readArtifact("wordpress-proposal", result.proposal.id)?.payload).toEqual(result.proposal);
    expect(result.limitations.some(item => item.includes("MOCK recommendation"))).toBe(true);
    expect(existsSync(join(directory, "protected-ai.sqlite"))).toBe(false);
    for (const secret of ["private-fixture-user", "private-fixture-password"]) expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("enforces exact approval/write gates, applies once, verifies stored/public values separately and survives restart", async () => {
    const preview = await editing.prepareMediaAlt(businessId, actor, input());
    await expect(wordpress.apply(businessId, actor, preview.proposal.id, "0".repeat(64))).rejects.toMatchObject({ status: 409 });
    await expect(wordpress.apply(businessId, actor, preview.proposal.id, preview.proposal.hash)).rejects.toMatchObject({ status: 403 });
    expect(writes()).toHaveLength(0);
    settings.WORDPRESS_WRITES_ENABLED = true;
    const applied = await wordpress.apply(businessId, actor, preview.proposal.id, preview.proposal.hash);
    expect(applied).toMatchObject({ status: "applied", verification: "verified_stored_fields" });
    expect(writes()).toHaveLength(1); expect(writes()[0][3]).toEqual({ alt_text: approvedAlt });
    expect(collect).not.toHaveBeenCalled();
    const publicResult = await verification.verify(businessId, actor, preview.proposal.id, "pages", 7);
    expect(publicResult).toMatchObject({ status: "verified", storedFieldMatches: true, matchedImages: 1, observedAlts: [approvedAlt] });
    database.close(); open();
    wire.mockClear(); collect.mockClear();
    expect(await wordpress.apply(businessId, actor, preview.proposal.id, preview.proposal.hash)).toEqual(applied);
    expect(await verification.read(businessId, actor, preview.proposal.id, publicResult.id)).toEqual(publicResult);
    expect(wire).not.toHaveBeenCalled(); expect(collect).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });

  it("keeps a public cache mismatch separate from verified stored fields and saves later verification independently", async () => {
    const preview = await editing.prepareMediaAlt(businessId, actor, input());
    settings.WORDPRESS_WRITES_ENABLED = true;
    await wordpress.apply(businessId, actor, preview.proposal.id, preview.proposal.hash);
    htmlAlt = "Cached old alternative";
    const first = await verification.verify(businessId, actor, preview.proposal.id, "pages", 7);
    expect(first).toMatchObject({ status: "mismatch", storedFieldMatches: true });
    htmlAlt = approvedAlt;
    const second = await verification.verify(businessId, actor, preview.proposal.id, "pages", 7);
    expect(second.status).toBe("verified"); expect(second.id).not.toBe(first.id);
    expect(await verification.read(businessId, actor, preview.proposal.id, first.id)).toEqual(first);
    expect(writes()).toHaveLength(1);
  });

  it("never uses an earlier proposal hash to approve edited text", async () => {
    const first = await editing.prepareMediaAlt(businessId, actor, input());
    const edited = await editing.prepareMediaAlt(businessId, actor, input("Different operator-reviewed alternative"));
    settings.WORDPRESS_WRITES_ENABLED = true;
    expect(edited.proposal.hash).not.toBe(first.proposal.hash);
    await expect(wordpress.apply(businessId, actor, edited.proposal.id, first.proposal.hash)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toHaveLength(0);
  });

  it("rejects missing, unbound and non-media saved recommendations before a target read", async () => {
    await expect(editing.prepareMediaAlt(businessId, actor, { ...input(), recommendationId: "absent" })).rejects.toMatchObject({ status: 404 });
    await expect(editing.prepareMediaAlt("another-business", actor, input())).rejects.toMatchObject({ status: 404 });
    await expect(editing.prepareMediaAlt(businessId, actor, { ...input(), recommendationId: "review_sample" })).rejects.toMatchObject({ status: 400 });
    settings.WORDPRESS_SITE_URL = "https://different.example";
    await expect(editing.prepareMediaAlt(businessId, actor, input())).rejects.toMatchObject({ status: 403 });
    expect(wire).not.toHaveBeenCalled();
  });

  it("rejects incompatible input and changed source hashes without a target read", async () => {
    await expect(editing.prepareMediaAlt(businessId, actor, { ...input(), altText: "x".repeat(2001) })).rejects.toMatchObject({ status: 400 });
    await expect(editing.prepareMediaAlt(businessId, actor, { ...input(), altText: "", extra: "not-allowed" } as ReturnType<typeof input>)).rejects.toMatchObject({ status: 400 });
    report.limitations.push("Source changed after analysis.");
    await expect(editing.prepareMediaAlt(businessId, actor, input())).rejects.toMatchObject({ status: 404 });
    expect(wire).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
});
