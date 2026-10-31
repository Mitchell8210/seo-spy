import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { MetaMuseError, MetaMuseProvider } from "../src/integrations/ai/meta-muse.provider.js";
import { WordPressMuseService } from "../src/modules/wordpress/wordpress-muse.service.js";
import { WordPressMuseStore } from "../src/modules/wordpress/wordpress-muse.store.js";
import { WORDPRESS_MUSE_OUTPUT_VERSION, wordpressMuseAnalysisSchema, type WordPressMuseOutput } from "../src/modules/wordpress/wordpress-muse.types.js";
import type { WordPressReportsService } from "../src/modules/wordpress/wordpress-reports.service.js";
import type { WordPressEvidenceReport } from "../src/modules/wordpress/wordpress-report.types.js";

const timestamp = "2026-10-31T12:00:00.000Z";
function fixture(): WordPressEvidenceReport {
  return {
    schemaVersion: "seo-spy.wordpress-evidence.v1", collectionPolicyVersion: "published-unprotected-v1", id: randomUUID(), businessId: "example", siteUrl: "https://example.com",
    startedAt: timestamp, generatedAt: timestamp, availability: "partial", sampleSize: 20,
    content: (["pages", "posts", "media"] as const).map((resource, index) => ({ resource, collectedAt: timestamp, availability: "available", items: [{ id: index + 7, title: "Published sample", modifiedAt: "2026-10-30T00:00:00", altText: resource === "media" ? "" : null, link: "https://example.com/public/" }], limitations: ["Bounded sample only."] })),
    rankMath: (["pages", "posts"] as const).map(resource => ({ resource, evidence: null, limitations: ["Rank Math is unavailable."] })),
    scoring: { seoSpyScore: null, policyVersion: null, storedScoreFreshness: "unknown" }, limitations: ["Source report is a bounded sample."],
  };
}
function output(report: WordPressEvidenceReport): WordPressMuseOutput {
  const evidence = `${report.id}:wordpress:media:9:content`;
  return {
    schemaVersion: WORDPRESS_MUSE_OUTPUT_VERSION, summary: "Review the sampled image's use before deciding whether alt text is needed.", summaryEvidenceIds: [evidence],
    observations: [{ id: "empty_alt", kind: "fact", text: "The stored media alternative is an empty string; its rendered use is unverified.", evidenceIds: [evidence] }],
    recommendations: [{ id: "review_image", observationIds: ["empty_alt"], resource: "media", targetContentId: 9, capabilityId: "wordpress.media.propose-update", recommendation: "Review whether this image is informative before proposing alt text.", rationale: "Decorative images may intentionally have an empty alternative.", effort: "small", risk: "low", verificationSteps: ["Inspect the rendered image context and stored field separately."], manualFallback: "Review in the WordPress media editor without applying an automated change.", evidenceIds: [evidence] }],
    limitations: ["No rendered inspection or fresh audit was performed."], seoSpyScore: null,
  };
}

describe("saved WordPress Muse interpretation with mocked provider and immutable storage", () => {
  let directory: string;
  let settings: Record<string, unknown>;
  let report: WordPressEvidenceReport;
  let reports: WordPressReportsService;
  let generate: ReturnType<typeof jest.fn<MetaMuseProvider["generate"]>>;
  let store: WordPressMuseStore;
  let service: WordPressMuseService;
  let authorization: { intentId: string; actor: string };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-wordpress-muse-"));
    settings = { WORDPRESS_MUSE_DIR: directory, AI_MODE: "poc", MOCK_AI: false };
    authorization = { intentId: randomUUID(), actor: "fixture-operator" };
    report = fixture();
    reports = { read: async (businessId: string, reportId: string) => {
      if (businessId !== report.businessId || reportId !== report.id) throw new NotFoundException();
      return structuredClone(report);
    } } as unknown as WordPressReportsService;
    generate = jest.fn<MetaMuseProvider["generate"]>().mockImplementation(async () => ({ output: output(report), model: "muse-spark-1.3", usage: { inputTokens: 100, outputTokens: 200 }, requestId: "req_123" }));
    store = new WordPressMuseStore(new ConfigService(settings));
    service = new WordPressMuseService(reports, { generate } as unknown as MetaMuseProvider, store, new ConfigService(settings));
  });
  afterEach(async () => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-wordpress-muse-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("prepares cost-free scoped evidence and publishes a separate validated interpretation", async () => {
    const original = structuredClone(report);
    const bundle = await service.prepare(report.businessId, report.id);
    expect(generate).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
    const analysis = await service.create(report.businessId, report.id, authorization);
    expect(analysis).toMatchObject({ schemaVersion: "seo-spy.wordpress-muse-analysis.v1", businessId: report.businessId, siteUrl: report.siteUrl, reportId: report.id, sourceHash: bundle.source.contentHash, model: "muse-spark-1.3", promptVersion: "wordpress-muse-prompt-v1", outputSchemaVersion: WORDPRESS_MUSE_OUTPUT_VERSION, output: output(report), usage: { inputTokens: 100, outputTokens: 200 } });
    expect(wordpressMuseAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(analysis.limitations.some(value => value.includes("Human review"))).toBe(true);
    expect(report).toEqual(original);
    expect((await store.read(analysis.id))?.sourceHash).toBe(bundle.source.contentHash);
    expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0][0];
    expect(request.input).toMatchObject({ source: bundle.source, business: bundle.business });
    expect((request.input as { observations: unknown[] }).observations.length).toBeLessThanOrEqual(12);
    expect(generate.mock.calls[0][2]).toMatchObject({ ...authorization, scope: `wordpress:${report.businessId}:${report.id}` });
    expect(request.instructions).toContain("untrusted source data");
    expect(request.instructions).toContain("Do not create executable patches");
    expect(request.schema).toMatchObject({ type: "object", additionalProperties: false });
    expect(analysis).not.toHaveProperty("approval");
    expect(analysis).not.toHaveProperty("proposal");
    expect(analysis).not.toHaveProperty("execution");
    expect(analysis.output.seoSpyScore).toBeNull();
  });
  it("reads after restart with AI disabled without model calls or source mutation", async () => {
    const analysis = await service.create(report.businessId, report.id, authorization);
    const saved = await readFile(join(directory, `${analysis.id}.json`), "utf8");
    const disabled = jest.fn<MetaMuseProvider["generate"]>().mockRejectedValue(new MetaMuseError("AI_DISABLED", "Model analysis is disabled."));
    const restarted = new WordPressMuseService(reports, { generate: disabled } as unknown as MetaMuseProvider, new WordPressMuseStore(new ConfigService(settings)), new ConfigService({ MOCK_AI: true, AI_MODE: "mock" }));
    expect(await restarted.read(report.businessId, report.id, analysis.id)).toEqual(analysis);
    expect(disabled).not.toHaveBeenCalled();
    expect(await readFile(join(directory, `${analysis.id}.json`), "utf8")).toBe(saved);
  });
  it("defaults local mock generation without keys or enabled AI and clearly identifies the fixture", async () => {
    delete settings.AI_MODE; delete settings.MOCK_AI;
    settings.AI_ENABLED = false; settings.MODEL_API_KEY = "";
    const analysis = await service.create(report.businessId, report.id);
    expect(analysis).toMatchObject({ generationMode: "mock", provider: "mock-fixture", isMock: true, fixtureVersion: "muse-development-fixtures-v1", usage: { inputTokens: 0, outputTokens: 0 }, requestId: null });
    expect(analysis.output.summary).toContain("Mock development fixture");
    expect(analysis.output.seoSpyScore).toBeNull();
    expect(analysis.limitations.some(value => value.includes("MOCK DATA"))).toBe(true);
    expect(analysis.usageAttemptId).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });
  it("never silently leaves mock mode when only one of its safety gates is changed", async () => {
    settings.MOCK_AI = true;
    const master = await service.create(report.businessId, report.id);
    expect(master.isMock).toBe(true);
    settings.AI_MODE = "mock"; settings.MOCK_AI = false;
    const mode = await service.create(report.businessId, report.id);
    expect(mode.isMock).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });
  it("reuses identical saved live analysis without another model call, including after restart", async () => {
    const first = await service.create(report.businessId, report.id, authorization);
    expect(await service.create(report.businessId, report.id)).toEqual(first);
    const restarted = new WordPressMuseService(reports, { generate } as unknown as MetaMuseProvider, new WordPressMuseStore(new ConfigService(settings)), new ConfigService(settings));
    expect(await restarted.create(report.businessId, report.id)).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ generationMode: "poc", provider: "meta", isMock: false });
  });
  it("isolates mock and live caches and requires approval before each uncached real request", async () => {
    settings.MOCK_AI = true;
    const mock = await service.create(report.businessId, report.id);
    expect((await service.create(report.businessId, report.id)).id).toBe(mock.id);
    settings.MOCK_AI = false;
    await expect(service.create(report.businessId, report.id)).rejects.toMatchObject({ response: { code: "AI_APPROVAL_REQUIRED" } });
    const live = await service.create(report.businessId, report.id, authorization);
    expect(live.id).not.toBe(mock.id);
    expect(live.isMock).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
    settings.AI_MAX_OUTPUT_TOKENS = 1000;
    await expect(service.create(report.businessId, report.id)).rejects.toMatchObject({ response: { code: "AI_APPROVAL_REQUIRED" } });
    settings.AI_MAX_OUTPUT_TOKENS = 1500; settings.AI_MODE = "demo";
    await expect(service.create(report.businessId, report.id)).rejects.toMatchObject({ response: { code: "AI_APPROVAL_REQUIRED" } });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("treats cache read failure as unavailable instead of requesting a paid fallback", async () => {
    jest.spyOn(store, "findByCacheKey").mockRejectedValueOnce(new ServiceUnavailableException({ code: "WORDPRESS_MUSE_STORAGE_ERROR" }));
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_STORAGE_ERROR" } });
    expect(generate).not.toHaveBeenCalled();
  });
  it("summarizes larger saved samples with explicit omissions and stable references before real generation", async () => {
    report.content.forEach(section => { section.items = Array.from({ length: 20 }, (_, index) => ({ ...section.items[0], id: section.items[0].id + index, title: "A bounded published title. ".repeat(12) })); });
    const analysis = await service.create(report.businessId, report.id, authorization);
    const input = generate.mock.calls[0][0].input as { observations: unknown[]; minimization: { omittedValues: number }; limitations: string[] };
    expect(input.observations).toHaveLength(6);
    expect(input.minimization.omittedValues).toBeGreaterThanOrEqual(54);
    expect(input.limitations.join(" ")).toContain("6 of 60");
    expect(Buffer.byteLength(JSON.stringify(generate.mock.calls[0][0]))).toBeLessThan(32768);
    expect(analysis.limitations.join(" ")).toContain("6 of 60");
    expect(analysis.output.summaryEvidenceIds[0]).toContain(report.id);
  });
  it("prepares an approval estimate without dispatching a model call", async () => {
    const estimate = jest.fn<MetaMuseProvider["estimate"]>().mockResolvedValue({ id: randomUUID() } as Awaited<ReturnType<MetaMuseProvider["estimate"]>>);
    const estimating = new WordPressMuseService(reports, { generate, estimate } as unknown as MetaMuseProvider, store, new ConfigService(settings));
    await estimating.estimate(report.businessId, report.id, "reviewing-operator", "Confirm structured output compatibility once.");
    expect(estimate).toHaveBeenCalledWith(expect.objectContaining({ instructions: expect.any(String), schema: expect.objectContaining({ type: "object" }) }), { actor: "reviewing-operator", scope: `wordpress:${report.businessId}:${report.id}`, reason: "Confirm structured output compatibility once." });
    expect(generate).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
  it("reads legacy analysis as unknown provenance without relabeling it or using it as a live cache", async () => {
    const analysis = await service.create(report.businessId, report.id, authorization);
    const legacy = { ...analysis, id: randomUUID() };
    delete legacy.generationMode; delete legacy.provider; delete legacy.isMock; delete legacy.cacheKey;
    await store.publish(legacy);
    const path = join(directory, `${legacy.id}.json`);
    const raw = await readFile(path, "utf8");
    const read = await service.read(report.businessId, report.id, legacy.id);
    expect(read.generationMode).toBeUndefined();
    expect(read.isMock).toBeUndefined();
    expect(read.limitations.some(value => value.includes("provenance is unknown"))).toBe(true);
    expect(await readFile(path, "utf8")).toBe(raw);
    expect(await store.findByCacheKey(report.businessId, report.siteUrl, report.id, "a".repeat(64))).toBeNull();
  });
  it("rejects incompatible mock/live provenance before publication", async () => {
    settings.MOCK_AI = true;
    const analysis = await service.create(report.businessId, report.id);
    expect(wordpressMuseAnalysisSchema.safeParse({ ...analysis, isMock: false }).success).toBe(false);
    expect(wordpressMuseAnalysisSchema.safeParse({ ...analysis, usage: { inputTokens: 1, outputTokens: 0 } }).success).toBe(false);
    expect(wordpressMuseAnalysisSchema.safeParse({ ...analysis, generationMode: "poc", provider: "meta", isMock: false }).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects unavailable or empty evidence before any paid generation", async () => {
    report.availability = "unavailable";
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_EVIDENCE_UNAVAILABLE" } });
    report.availability = "partial";
    report.content.forEach(section => { section.items = []; });
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_EVIDENCE_UNAVAILABLE" } });
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects legacy privacy-unverified source reports before any provider call", async () => {
    delete report.collectionPolicyVersion;
    await expect(service.prepare(report.businessId, report.id)).rejects.toMatchObject({ status: 400 });
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ status: 400 });
    expect(generate).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
  it("does not accept caller-selected business/report ownership before analysis", async () => {
    await expect(service.prepare("other-business", report.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(report.businessId, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([
    (value: WordPressMuseOutput) => { value.summaryEvidenceIds = [`${randomUUID()}:wordpress:media:9:content`]; },
    (value: WordPressMuseOutput) => { value.observations[0].evidenceIds = ["unlisted-source"]; },
    (value: WordPressMuseOutput) => { value.recommendations[0].targetContentId = 999; },
    (value: WordPressMuseOutput) => { value.recommendations[0].resource = "posts"; },
    (value: WordPressMuseOutput) => { value.recommendations[0].targetContentId = null; },
    (value: WordPressMuseOutput) => { value.recommendations[0].observationIds = ["invented_observation"]; },
    (value: WordPressMuseOutput) => { value.observations.push(structuredClone(value.observations[0])); },
    (value: WordPressMuseOutput) => { value.recommendations.push(structuredClone(value.recommendations[0])); },
    (value: WordPressMuseOutput) => { value.summaryEvidenceIds.push(value.summaryEvidenceIds[0]); },
  ])("rejects unresolved/cross-report references and mismatched targets without publication %#", async mutate => {
    const invalid = output(report); mutate(invalid);
    generate.mockResolvedValue({ output: invalid, model: "muse-spark-1.3", usage: { inputTokens: 1, outputTokens: 2 }, requestId: null });
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_OUTPUT_INVALID" } });
    expect(await readdir(directory)).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([
    { executablePatch: { altText: "Unapproved" } },
    { seoSpyScore: 93 },
    { tools: [{ name: "wordpress.apply" }] },
    { summary: "x".repeat(281) },
  ])("rejects extra executable fields, invented score and schema violations %j", async patch => {
    generate.mockResolvedValue({ output: { ...output(report), ...patch }, model: "muse-spark-1.3", usage: { inputTokens: 1, outputTokens: 2 }, requestId: null });
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_OUTPUT_INVALID" } });
    expect(await readdir(directory)).toEqual([]);
  });
  it("validates capability IDs and rejects executable parameters nested inside recommendations", async () => {
    for (const patch of [{ capabilityId: "wordpress.media.delete" }, { arguments: { url: "https://attacker.invalid", method: "POST" } }]) {
      const invalid = output(report);
      generate.mockResolvedValue({ output: { ...invalid, recommendations: [{ ...invalid.recommendations[0], ...patch }] }, model: "muse-spark-1.3", usage: { inputTokens: 1, outputTokens: 2 }, requestId: null });
      await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_OUTPUT_INVALID" } });
    }
    expect(await readdir(directory)).toEqual([]);
  });
  it("allows manual-only guidance with observed targets, and general guidance with no executable capability", async () => {
    const value = output(report);
    const ref = `${report.id}:wordpress:pages:7:content`;
    value.summaryEvidenceIds = [ref]; value.observations[0].evidenceIds = [ref];
    Object.assign(value.recommendations[0], { resource: "pages", targetContentId: 7, capabilityId: "rank-math.seo-metadata.update", evidenceIds: [ref] });
    generate.mockResolvedValue({ output: value, model: "muse-spark-1.3", usage: { inputTokens: 1, outputTokens: 2 }, requestId: null });
    expect((await service.create(report.businessId, report.id, authorization)).output.recommendations[0].capabilityId).toBe("rank-math.seo-metadata.update");
    value.recommendations[0].targetContentId = null; value.recommendations[0].capabilityId = null;
    settings.AI_REASONING_EFFORT = "minimal"; // A genuinely changed request is a cache miss.
    expect((await service.create(report.businessId, report.id, authorization)).output.recommendations[0].targetContentId).toBeNull();
  });
  it("maps disabled/budget provider failure safely and clears the active marker for an explicit later request", async () => {
    generate.mockRejectedValueOnce(new MetaMuseError("AI_BUDGET_DISABLED", "A positive model call limit must be explicitly configured."));
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "AI_BUDGET_DISABLED" } });
    expect(await readdir(directory)).toEqual([]);
    await expect(service.create(report.businessId, report.id, authorization)).resolves.toHaveProperty("id");
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("rejects duplicate in-flight generation and performs only the originally initiated call", async () => {
    let finish!: (value: Awaited<ReturnType<MetaMuseProvider["generate"]>>) => void;
    let called!: () => void;
    const started = new Promise<void>(resolve => { called = resolve; });
    generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; called(); }));
    const first = service.create(report.businessId, report.id, authorization);
    await started;
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_ANALYSIS_ACTIVE" } });
    finish({ output: output(report), model: "muse-spark-1.3", usage: { inputTokens: 1, outputTokens: 2 }, requestId: null });
    await first;
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("does not claim saved success when immutable publication fails", async () => {
    jest.spyOn(store, "publish").mockRejectedValueOnce(new ServiceUnavailableException({ code: "WORDPRESS_MUSE_STORAGE_ERROR" }));
    await expect(service.create(report.businessId, report.id, authorization)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_STORAGE_ERROR" } });
    expect(await readdir(directory)).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong business/report/site/source hash on saved reads", async () => {
    const analysis = await service.create(report.businessId, report.id, authorization);
    await expect(service.read("other-business", report.id, analysis.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.read(report.businessId, randomUUID(), analysis.id)).rejects.toBeInstanceOf(NotFoundException);
    report.id = randomUUID();
    await expect(service.read(report.businessId, report.id, analysis.id)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_ANALYSIS_NOT_FOUND" } });
    report.id = analysis.reportId; report.siteUrl = "https://new-site.example";
    await expect(service.read(report.businessId, report.id, analysis.id)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_ANALYSIS_NOT_FOUND" } });
    report.siteUrl = analysis.siteUrl; report.content[0].items[0].title = "Changed saved evidence";
    await expect(service.read(report.businessId, report.id, analysis.id)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_ANALYSIS_NOT_FOUND" } });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("refuses to overwrite an existing analysis, including concurrent duplicate publication", async () => {
    const analysis = await service.create(report.businessId, report.id, authorization);
    const original = await readFile(join(directory, `${analysis.id}.json`), "utf8");
    await expect(store.publish({ ...analysis, output: { ...analysis.output, summary: "Altered" } })).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_ANALYSIS_EXISTS" } });
    const another = { ...analysis, id: randomUUID() };
    const results = await Promise.allSettled([store.publish(another), store.publish(another)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await readFile(join(directory, `${analysis.id}.json`), "utf8")).toBe(original);
    expect((await readdir(directory)).every(name => name.endsWith(".json"))).toBe(true);
  });
  it("fails closed for unsafe IDs, corrupt files, mismatched filename IDs and oversized files", async () => {
    await expect(store.read("../private-key")).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_STORAGE_ERROR" } });
    expect(await store.read(randomUUID())).toBeNull();
    const analysis = await service.create(report.businessId, report.id, authorization);
    const path = join(directory, `${analysis.id}.json`);
    for (const body of ["{invalid", JSON.stringify({ ...analysis, id: randomUUID() }), "x".repeat(512 * 1024 + 1)]) {
      await writeFile(path, body);
      await expect(store.read(analysis.id)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_STORAGE_ERROR" } });
    }
  });
  it("rejects a configured directory junction and unsafe file types without exposing filesystem paths", async () => {
    const actual = join(directory, "actual"); const alias = join(directory, "alias");
    await mkdir(actual); await symlink(actual, alias, "junction");
    const unsafe = new WordPressMuseStore(new ConfigService({ WORDPRESS_MUSE_DIR: alias }));
    await expect(unsafe.read(randomUUID())).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_STORAGE_ERROR" } });
    const id = randomUUID(); await mkdir(join(directory, `${id}.json`));
    try { await store.read(id); } catch (error) { expect(String(error)).not.toContain(directory); }
    await expect(store.read(id)).rejects.toMatchObject({ response: { code: "WORDPRESS_MUSE_STORAGE_ERROR" } });
  });
});
