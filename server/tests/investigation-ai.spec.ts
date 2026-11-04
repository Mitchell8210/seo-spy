import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { InvestigationInterpretationStore } from "../src/reporting/investigation-interpretation.store.js";
import { InvestigationAiService, interpretationInput } from "../src/modules/investigation-ai/investigation-ai.service.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MetaMuseProvider, MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { operatorIdentity } from "../src/modules/wordpress/wordpress.guard.js";
import { createDemoResults } from "../src/fixtures/demo.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { FileReportStore } from "../src/reports/file-report.store.js";
import type { BusinessRepository } from "../src/persistence/repositories.js";

const at = "2026-11-03T10:00:00.000Z", businessId = "demo-guzman";
const business = { id: businessId, name: "Fixture accounting business", website: "https://example.com/", createdAt: at };
const context = { actor: operatorIdentity("authorized-local-account"), businessId, siteUrl: business.website };
function report(): AuditReportRecord {
  const id = randomUUID(), results = createDemoResults(id, at);
  results.evidence = [{ id: "first-evidence", auditId: id, sourceUrl: business.website, collectedAt: at, mode: "live", checkId: "page-title", observed: { title: "Accounting services", apiToken: "private-credential", html: "<script>do not run</script>" } },
    { id: "second-evidence", auditId: id, sourceUrl: business.website, collectedAt: at, mode: "live", checkId: "page-title", observed: { title: "Accounting services" } }];
  results.findings = [{ id: "first-finding", auditId: id, checkId: "page-title", evidenceIds: ["first-evidence"], severity: "medium", source: "website", title: "Clarify the service page title", explanation: "The recorded title is broad.", status: "needs_review" }];
  return { schemaVersion: "seo-spy.audit-report.v1", reportId: id, auditId: id, generatedAt: at, business, results,
    audit: { id, businessId, scope: "lighthouse", mode: "live", strategy: "mobile", status: "completed", stage: "complete", createdAt: at, startedAt: at, completedAt: at, warnings: [], failure: null, scoringVersion: "lighthouse-v1" } };
}
describe("Post-investigation AI interpretation with the real shared accounting ledger", () => {
  let directory: string, appDb: AppDatabase, ledger: AiUsageStore, store: InvestigationInterpretationStore, service: InvestigationAiService, saved: AuditReportRecord;
  const post = jest.fn<MetaMuseTransport["post"]>();
  const output = () => ({ summary: "Make the service easier to understand before visitors contact the business.", recommendations: [{ category: "website", title: "Make the title specific to the service",
    recommendation: "Rewrite the recorded broad title to name the actual service and location after confirming those facts with the owner.", rationale: "The saved title only identifies a broad accounting service.", evidence: [0], finding: 0 as number | null, verification: "Check the updated page title in the next website report." }] });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-report-ai-"));
    const config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AI_USAGE_DB: join(directory, "usage.sqlite"), MODEL_API_KEY: "offline-fixture-key", AI_ENABLED: false, MOCK_AI: true, AI_MODE: "mock" });
    appDb = new AppDatabase(config); ledger = new AiUsageStore(config); store = new InvestigationInterpretationStore(appDb); saved = report();
    const provider = new MetaMuseProvider(config, { post } as unknown as MetaMuseTransport, ledger);
    service = new InvestigationAiService({ read: async (id: string) => id === saved.auditId ? structuredClone(saved) : null } as unknown as FileReportStore,
      store, provider, { findById: async () => business } as unknown as BusinessRepository);
    post.mockReset();
    post.mockImplementation(async () => ({ status: 200, requestId: "offline-model-response", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 300 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output()) }] }] }) }));
  });
  afterEach(async () => {
    ledger.onModuleDestroy(); appDb.onApplicationShutdown();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-report-ai-")) throw new Error("Unexpected fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  });
  it("makes one accounted call, validates citations, persists independent recommendations and leaves scores/evidence unchanged", async () => {
    const original = structuredClone(saved), result = await service.interpret(context, [saved.auditId]);
    expect(result.status).toBe("completed"); expect(result.attemptId).toBeTruthy();
    expect(result.recommendations[0]).toMatchObject({ findingId: "first-finding", evidenceRefs: [{ reportId: saved.auditId, evidenceId: "first-evidence" }] });
    expect(saved).toEqual(original);
    const payload = JSON.parse(post.mock.calls[0][0]);
    expect(payload.tools).toEqual([]); expect(payload.store).toBe(false); expect(payload.max_output_tokens).toBe(1500);
    expect(JSON.stringify(payload)).not.toMatch(/private-credential|<script>/);
    const usage = await ledger.status(); expect(usage.development.budgetMicros).toBe(25000000); expect(usage.development.calls).toBe(1);
    expect(usage.recentAttempts[0]).toMatchObject({ status: "success", id: result.attemptId });
    expect(await service.interpret(context, [saved.auditId])).toEqual(result);
    expect(store.saved(businessId, [saved.auditId])).toEqual(result); expect(post).toHaveBeenCalledTimes(1);
  });
  it("can produce a new recommendation from measured evidence without an existing coded finding", async () => {
    const generated = output(); generated.recommendations[0].finding = null;
    post.mockResolvedValueOnce({ status: 200, requestId: "offline", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 300 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(generated) }] }] }) });
    const result = await service.interpret(context, [saved.auditId]);
    expect(result.status).toBe("completed"); expect(result.recommendations[0].findingId).toBeNull();
  });
  it("retains exact evidence identity when multiple items share a check and observation", () => {
    const prepared = interpretationInput([saved], "request", context.siteUrl);
    expect(prepared.bindings.map(ref => ref.evidenceId)).toEqual(["first-evidence", "second-evidence"]);
  });
  it("accepts additional measured context when the recommendation also cites its linked finding", async () => {
    saved.results!.evidence.push({ ...saved.results!.evidence[0], id: "context-evidence", checkId: "context" });
    const generated = output(); generated.recommendations[0].evidence = [0, 2];
    post.mockResolvedValueOnce({ status: 200, requestId: "offline", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 300 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(generated) }] }] }) });
    const result = await service.interpret(context, [saved.auditId]);
    expect(result.status).toBe("completed"); expect(result.recommendations[0].evidenceRefs).toHaveLength(2);
  });
  it.each(["citation", "category", "finding", "truncated"])("rejects invalid model output (%s) without changing the report or retrying", async fault => {
    const generated = output();
    if (fault === "citation") generated.recommendations[0].evidence = [999];
    if (fault === "category") generated.recommendations[0].category = "social";
    if (fault === "finding") generated.recommendations[0].finding = 99;
    post.mockResolvedValueOnce({ status: 200, requestId: "offline", body: JSON.stringify({ status: fault === "truncated" ? "incomplete" : "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 300 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(generated) }] }] }) });
    const first = await service.interpret(context, [saved.auditId]); expect(first.status).toBe("failed"); expect(first.recommendations).toEqual([]);
    expect((await service.interpret(context, [saved.auditId])).status).toBe("failed"); expect(post).toHaveBeenCalledTimes(1);
  });
  it("rejects unbound business/site identities before any model call", async () => {
    await expect(service.interpret({ ...context, siteUrl: "https://another.example/" }, [saved.auditId])).rejects.toThrow();
    await expect(service.interpret(context, [randomUUID()])).rejects.toThrow(); expect(post).not.toHaveBeenCalled();
  });
  it("does not replay an interrupted pending interpretation after restart", async () => {
    const first = await service.interpret(context, [saved.auditId]);
    const row = appDb.connection().prepare("SELECT cache_key FROM investigation_interpretations WHERE id=?").get(first.id)!;
    const pending = { ...first, id: randomUUID(), status: "pending" as const, summary: null, attemptId: null, recommendations: [] };
    const alternateDb = new AppDatabase(new ConfigService({ DATABASE_PATH: ":memory:" }));
    const alternate = new InvestigationInterpretationStore(alternateDb);
    alternate.reserve(String(row.cache_key), pending);
    const provider = { prepare: () => ({ requestHash: String(row.cache_key), model: "muse-spark-1.3" }), generateFrontend: jest.fn() };
    const next = new InvestigationAiService({ read: async () => saved } as unknown as FileReportStore, alternate, provider as unknown as MetaMuseProvider, { findById: async () => business } as unknown as BusinessRepository);
    expect((await next.interpret(context, [saved.auditId])).status).toBe("pending"); expect(provider.generateFrontend).not.toHaveBeenCalled();
    alternateDb.onApplicationShutdown();
  });
});
