import { withHistoricalAiPolicy, historicalTestingLimits } from "./fixtures/historical-ai-policy.js";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import type { AiUsageEstimateInput } from "../src/integrations/ai/ai-usage.types.js";
import { MUSE_TESTING_POLICY_HASH, type TestingReceipt } from "../src/integrations/ai/muse-testing-ledger.js";
import { WORDPRESS_ALT_FUNDING_POLICY, WORDPRESS_ALT_FUNDING_POLICY_HASH, type WordPressAltFundingRequest, type WordPressAltReceipt } from "../src/integrations/ai/muse-wordpress-alt-ledger.js";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { buildAltModelInput } from "../src/modules/wordpress/wordpress-alt-request.js";
import { validateAltOutput, type AltEvidence } from "../src/modules/wordpress/wordpress-fix.types.js";

const admin = "a".repeat(64), operator = "b".repeat(64), businessId = "offline-funding-business", contextId = "ecde7160-2490-4366-afcd-e31a87fb909a";
const assessmentId = "42293e59-b979-46f3-875f-bb4b0a5b49ba";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const firstHash = hash("first assessment"), altHash = hash("exact Spanish alt request");
const metadata = { assessmentId, businessId, inputHash: hash("input"), sourceManifestHash: hash("sources"), analysisCacheKey: hash("cache"), reasoning: "minimal" as const,
  promptVersion: "assessment-muse-prompt-v3", outputSchemaVersion: "assessment-muse-output-v3" as const };
const assessmentInput = (requestHash = firstHash, reserveMicros = 10000): AiUsageEstimateInput => ({ actor: admin, scope: `assessment:${businessId}:${assessmentId}`, requestHash, cacheKey: requestHash,
  mode: "poc", model: "muse-spark-1.3", maxInputTokens: 100, maxOutputTokens: 1500, reserveMicros, priceVersion: "offline-price", reason: "Explicit disposable testing fixture" });
const fundingRequest = (): WordPressAltFundingRequest => ({ actor: operator, businessId, evidenceContextId: contextId, requestHash: altHash, model: "muse-spark-1.3", processingMode: "standard", reasoningEffort: "minimal",
  maxInputTokens: 100, maxOutputTokens: 1500, reserveMicros: 33615, priceVersion: "offline-price", inputPriceMicrosPerMillion: 1250000, outputPriceMicrosPerMillion: 4250000 });
const altInput = (): AiUsageEstimateInput => ({ actor: operator, scope: `wordpress-alt:${businessId}:${contextId}`, requestHash: altHash, cacheKey: altHash,
  mode: "poc", model: "muse-spark-1.3", maxInputTokens: 100, maxOutputTokens: 1500, reserveMicros: 33615, priceVersion: "offline-price", reason: "One explicit exact WordPress alt fixture" });

describe("historical WordPress funding compatibility and current shared spending", () => {
  let directory: string, path: string, ledger: AiUsageStore;
  const tick = () => jest.setSystemTime(Date.now() + 61000);
  beforeEach(async () => {
    jest.useFakeTimers({ now: Date.parse("2026-11-02T10:00:00.000Z") });
    directory = await mkdtemp(join(tmpdir(), "seo-spy-alt-funding-")); path = join(directory, "usage.sqlite");
    ledger = new AiUsageStore(new ConfigService({ AI_USAGE_DB: path }));
    for (const [index, reserveMicros] of [131460, 6544, 6544, 8196].entries()) {
      const input = { ...assessmentInput(hash(`history-${index}`), reserveMicros), maxInputTokens: 10, maxOutputTokens: 128 };
      const intent = await ledger.estimate(input); await ledger.approve(intent.id, admin);
      const reserved = await ledger.reserve(intent.id, { actor: admin, requestHash: input.requestHash, mode: "poc" });
      await ledger.settle(reserved.id, index === 3 ? { status: "success", inputTokens: 10, outputTokens: 105, actualMicros: 460 } : { status: "failed", errorCode: "AI_FIXTURE_FAILURE" }); tick();
    }
    await withHistoricalAiPolicy(path, historicalTestingLimits, () => ledger.activateTestingAllocation(admin, { confirmed: true, policyHash: MUSE_TESTING_POLICY_HASH, requestHash: firstHash, maximumMicros: 10000 }));
    await assessment(firstHash);
  });
  afterEach(async () => {
    ledger.onModuleDestroy(); jest.useRealTimers();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true });
  });
  async function assessment(requestHash: string, reserveMicros = 10000) {
    const intent = await ledger.estimateTesting(assessmentInput(requestHash, reserveMicros), metadata); await ledger.approve(intent.id, admin);
    const attempt = await ledger.reserve(intent.id, { actor: admin, requestHash, mode: "poc" });
    await ledger.settle(attempt.id, { status: "success", inputTokens: 0, outputTokens: 0, actualMicros: 0, requestId: "offline-assessment" });
    const receipt: TestingReceipt = { assessmentId, inputHash: metadata.inputHash, requestHash, model: "muse-spark-1.3", reasoning: "minimal", inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      estimatedTokenMicros: 0, reservedMicros: reserveMicros, ledgerChargeMicros: 0, attemptId: attempt.id, requestId: "offline-assessment", httpStatus: 200, completionStatus: "completed", incompletionReason: null,
      failureCategory: null, providerError: null, schemaValid: true, idsValid: true, persisted: true, analysisId: randomUUID(), cacheHit: false, selectedIds: { strengths: [], weaknesses: [], recommendations: [] } };
    await ledger.completeTestingReceipt(admin, intent.id, receipt); tick(); return intent;
  }
  async function activate() {
    const preview = await ledger.prepareWordPressAltFunding(admin, fundingRequest());
    return ledger.activateWordPressAltFunding(admin, fundingRequest(), { confirmed: true, policyHash: preview.policyHash, fundingHash: preview.fundingHash });
  }
  async function reserveAlt() {
    const intent = await ledger.estimateWordPressAlt(altInput()); await ledger.approve(intent.id, admin);
    const attempt = await ledger.reserve(intent.id, { actor: operator, scope: altInput().scope, requestHash: altHash, mode: "poc" });
    return { intent, attempt };
  }
  async function settleAlt(intentId: string, attemptId: string, status: "success" | "failed" | "unknown" = "success") {
    await ledger.settle(attemptId, { status, inputTokens: 0, outputTokens: 0, actualMicros: 0, requestId: "offline-alt", ...(status === "success" ? {} : { errorCode: "AI_OFFLINE_FAILURE" }) });
    const attempt = await ledger.wordPressAltAttempt(intentId);
    const receipt: WordPressAltReceipt = { requestHash: altHash, evidenceContextId: contextId, attemptId, reservedMicros: 33615, ledgerChargeMicros: Number(attempt!.charged_micros), inputTokens: 0, outputTokens: 0,
      requestId: "offline-alt", httpStatus: status === "success" ? 200 : null, completionStatus: status === "success" ? "completed" : null, schemaValid: status === "success", persisted: status === "success",
      generationId: status === "success" ? randomUUID() : null, failureCategory: status === "success" ? null : "AI_OFFLINE_FAILURE" };
    return receipt;
  }

  it("prepares funding on a stable copy without opening or changing the source ledger", async () => {
    ledger.onModuleDestroy();
    const before = await readFile(path), sentinel = await readFile(path + ".initialized");
    const preview = await ledger.prepareWordPressAltFunding(admin, fundingRequest());
    expect(await readFile(path)).toEqual(before); expect(await readFile(path + ".initialized")).toEqual(sentinel);
    expect(preview).toMatchObject({ policyHash: WORDPRESS_ALT_FUNDING_POLICY_HASH, noAuthorizationCreated: true, noPaidIntentCreated: true,
      transferMicros: 33615, assessmentBefore: { fundedMicros: 1854992, availableCalls: 9 }, assessmentAfter: { fundedMicros: 1821377, availableCalls: 8 } });
    expect((await ledger.status()).wordPressAlt).toBeUndefined();
  });
  it("earmarks exact funding and one slot without changing old allocations, caps or usage", async () => {
    const before = await ledger.status(); await activate(); const after = await ledger.status();
    expect(after.development).toEqual(before.development); expect(after.demo).toEqual(before.demo); expect(after.recentAttempts).toEqual(before.recentAttempts);
    expect(after.testing).toMatchObject({ allocation: before.testing!.allocation, calls: 1, effectiveFundedMicros: 1821377, effectiveMaxCalls: 9, earmarkedWordPressAltMicros: 33615 });
    expect(after.wordPressAlt).toMatchObject({ calls: 0, chargedMicros: 0, dailyReservedMicros: 0, funding: { request: fundingRequest() } });
    await expect(activate()).rejects.toMatchObject({ code: "AI_WORDPRESS_ALT_ALREADY_FUNDED" });
  });
  it.each(["confirmation", "policy", "funding-hash", "actor", "amount", "context", "request"])("rejects changed %s at funding activation without any partial debit", async kind => {
    const preview = await ledger.prepareWordPressAltFunding(admin, fundingRequest()), before = await ledger.status(), target = fundingRequest();
    if (kind === "amount") target.reserveMicros--;
    if (kind === "context") target.evidenceContextId = randomUUID();
    if (kind === "request") target.requestHash = hash("changed");
    await expect(ledger.activateWordPressAltFunding(kind === "actor" ? operator : admin, target, { confirmed: kind !== "confirmation", policyHash: kind === "policy" ? hash("wrong") : preview.policyHash,
      fundingHash: kind === "funding-hash" ? hash("wrong") : preview.fundingHash })).rejects.toBeDefined();
    expect(await ledger.status()).toEqual(before);
  });
  it("rejects a reservation beyond the reviewed ceiling and funding previews against changed history", async () => {
    await expect(ledger.prepareWordPressAltFunding(admin, { ...fundingRequest(), reserveMicros: 33616 })).rejects.toBeDefined();
    const preview = await ledger.prepareWordPressAltFunding(admin, fundingRequest()); await assessment(hash("new-history"));
    await expect(ledger.activateWordPressAltFunding(admin, fundingRequest(), { confirmed: true, policyHash: preview.policyHash, fundingHash: preview.fundingHash })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
  });
  it("limits the revised ceiling to the explicitly approved exact request without adding a second grant or paid approval", async () => {
    const scope = WORDPRESS_ALT_FUNDING_POLICY.amendment;
    const target = { ...fundingRequest(), businessId: scope.businessId, evidenceContextId: scope.evidenceContextId,
      requestHash: scope.requestHash, maxInputTokens: 22172, reserveMicros: 34090 };
    const before = await ledger.status(), preview = await ledger.prepareWordPressAltFunding(admin, target);
    for (const change of [{ reserveMicros: 34091 }, { businessId }, { evidenceContextId: contextId }, { requestHash: altHash }])
      await expect(ledger.prepareWordPressAltFunding(admin, { ...target, ...change })).rejects.toBeDefined();
    await ledger.activateWordPressAltFunding(admin, target, { confirmed: true, policyHash: preview.policyHash, fundingHash: preview.fundingHash });
    const after = await ledger.status();
    expect(after.development).toEqual(before.development); expect(after.demo).toEqual(before.demo); expect(after.recentAttempts).toEqual(before.recentAttempts);
    expect(after.testing!.effectiveFundedMicros).toBe(before.testing!.allocation.fundedMicros - 34090);
    expect(after.wordPressAlt).toMatchObject({ calls: 0, chargedMicros: 0, funding: { request: target } });
    await expect(activate()).rejects.toMatchObject({ code: "AI_WORDPRESS_ALT_ALREADY_FUNDED" });
  });
  it("automatically authorizes shared spending independently of historical funding grants", async () => {
    await activate();
    const before = await ledger.status(), intent = await ledger.estimate(altInput());
    expect(intent.approvedBy).toBe(operator); expect(intent.consumedAt).toBeNull();
    await expect(ledger.reserve(intent.id, { actor: admin, requestHash: altHash, mode: "poc" })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    const attempt = await ledger.reserve(intent.id, { actor: operator, requestHash: altHash, mode: "poc" });
    expect((await ledger.status()).development.chargedMicros).toBe(before.development.chargedMicros + attempt.reserveMicros);
  });

  it("reports only an existing exact approved browser generation intent without granting or consuming it", async () => {
    await activate(); const intent = await ledger.estimateWordPressAlt(altInput());
    expect(await ledger.wordPressAltApproval(operator, altInput().scope, altHash)).toEqual({ status: "pending_approval" });
    await ledger.approve(intent.id, admin);
    expect(await ledger.wordPressAltApproval(operator, altInput().scope, altHash)).toEqual({ status: "approved", intentId: intent.id });
    expect(await ledger.wordPressAltApproval(admin, altInput().scope, altHash)).toEqual({ status: "pending_approval" });
    expect(await ledger.wordPressAltApproval(operator, altInput().scope, hash("different input"))).toEqual({ status: "pending_approval" });
    expect((await ledger.readIntent(intent.id)).consumedAt).toBeNull();
    jest.setSystemTime(Date.now() + 16 * 60000);
    expect(await ledger.wordPressAltApproval(operator, altInput().scope, altHash)).toEqual({ status: "expired" });
    expect((await ledger.status()).wordPressAlt!.calls).toBe(0);
  });
  it("keeps the paid approval fifteen-minute expiry independent of unchanged purpose facts or execution refreshes", async () => {
    const grant = await activate(), input = altInput(), intent = await ledger.estimateWordPressAlt(input);
    await ledger.approve(intent.id, admin);
    const before = await ledger.status();
    jest.setSystemTime(Date.now() + 16 * 60000);
    // A fresh execution-state ID or check timestamp is deliberately absent from
    // this exact payload/scope. Fresh machine checks cannot extend paid consent.
    expect(altInput()).toEqual(input);
    await expect(ledger.reserve(intent.id, { actor: operator, scope: input.scope, requestHash: input.requestHash, mode: "poc" })).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    expect(await ledger.wordPressAltAttempt(intent.id)).toBeNull();
    await expect(ledger.estimateWordPressAlt(input)).rejects.toMatchObject({ code: "AI_WORDPRESS_ALT_INTENT_EXISTS" });
    await expect(ledger.estimateWordPressAlt({ ...input, requestHash: hash("changed factual before-value"), cacheKey: hash("changed factual before-value") })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    const after = await ledger.status();
    expect(after.recentAttempts).toEqual(before.recentAttempts);
    expect(after.development).toEqual(before.development);
    expect(after.testing).toMatchObject({ effectiveFundedMicros: 1821377, effectiveMaxCalls: 9, earmarkedWordPressAltMicros: 33615 });
    expect(after.wordPressAlt).toMatchObject({ calls: 0, chargedMicros: 0, funding: { fundingHash: grant.fundingHash, request: fundingRequest() } });
  });
  it.each(["actor", "scope", "hash", "model", "tokens", "cost", "price"])("rejects changed %s in the linked exact estimate", async kind => {
    await activate(); const input = altInput();
    if (kind === "actor") input.actor = admin;
    if (kind === "scope") input.scope = `wordpress-alt:other:${contextId}`;
    if (kind === "hash") input.requestHash = hash("changed");
    if (kind === "model") input.model = "muse-spark-1.2";
    if (kind === "tokens") input.maxOutputTokens = 1499;
    if (kind === "cost") input.reserveMicros--;
    if (kind === "price") input.priceVersion = "another-price";
    await expect(ledger.estimateWordPressAlt(input)).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    expect((await ledger.status()).wordPressAlt!.calls).toBe(0);
  });
  it("counts a historical linked attempt in the shared cumulative total", async () => {
    await activate(); const before = await ledger.status(), { intent, attempt } = await reserveAlt();
    const state = await ledger.status(); expect(state.development).toMatchObject({ calls: before.development.calls + 1, chargedMicros: before.development.chargedMicros + 33615 });
    expect(state.wordPressAlt).toMatchObject({ calls: 1, chargedMicros: 33615, dailyReservedMicros: 33615, incompleteReceipts: 1 });
    expect(state.testing).toMatchObject({ calls: 1, dailyReservedMicros: 43615, incompleteReceipts: 1 });
    await expect(ledger.reserve(intent.id, { actor: operator, requestHash: altHash, mode: "poc" })).rejects.toBeDefined();
    const receipt = await settleAlt(intent.id, attempt.id); await ledger.completeWordPressAltReceipt(admin, intent.id, receipt);
    expect(await ledger.wordPressAltReceipts()).toEqual([receipt]);
    await expect(ledger.completeWordPressAltReceipt(admin, intent.id, receipt)).rejects.toBeDefined();
    await expect(ledger.estimateWordPressAlt(altInput())).rejects.toMatchObject({ code: "AI_WORDPRESS_ALT_INTENT_EXISTS" });
  });
  it("blocks future assessment work until the alt receipt is independently finalized", async () => {
    await activate(); const { intent, attempt } = await reserveAlt(), receipt = await settleAlt(intent.id, attempt.id);
    await expect(ledger.estimateTesting(assessmentInput(hash("next")), metadata)).rejects.toMatchObject({ code: "AI_TESTING_REVIEW_REQUIRED" });
    await ledger.completeWordPressAltReceipt(admin, intent.id, receipt); tick(); await assessment(hash("next"));
  });
  it("retains unknown settlement, its receipt and global halt without corrupting funding history", async () => {
    await activate(); const { intent, attempt } = await reserveAlt(), receipt = await settleAlt(intent.id, attempt.id, "unknown");
    expect((await ledger.status()).halted).toBe(true);
    await ledger.completeWordPressAltReceipt(admin, intent.id, receipt);
    expect(await ledger.wordPressAltReceipts()).toEqual([receipt]);
    const state = await ledger.status(); expect(state.activeAttemptId).toBe(attempt.id); expect(state.wordPressAlt!.chargedMicros).toBe(33615);
    await expect(ledger.reserve(intent.id, { actor: operator, requestHash: altHash, mode: "poc" })).rejects.toBeDefined();
  });
  it("rejects malformed receipts and retains the incomplete-receipt lock", async () => {
    await activate(); const { intent, attempt } = await reserveAlt(), receipt = await settleAlt(intent.id, attempt.id);
    await expect(ledger.completeWordPressAltReceipt(admin, intent.id, { ...receipt, ledgerChargeMicros: 1 })).rejects.toBeDefined();
    await expect(ledger.completeWordPressAltReceipt(operator, intent.id, receipt)).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    expect((await ledger.status()).testing!.incompleteReceipts).toBe(1);
  });
  it("debits one global policy slot rather than allowing eleven attempts", async () => {
    await activate(); for (let index = 0; index < 8; index++) await assessment(hash(`assessment-${index}`));
    await expect(ledger.estimateTesting(assessmentInput(hash("tenth-assessment")), metadata)).rejects.toMatchObject({ code: "AI_TESTING_LIMIT" });
    const { intent, attempt } = await reserveAlt(), receipt = await settleAlt(intent.id, attempt.id); await ledger.completeWordPressAltReceipt(admin, intent.id, receipt);
    const state = await ledger.status(); expect(state.testing!.calls + state.wordPressAlt!.calls).toBe(10);
  });
  it("shares the daily reservation ceiling with assessment testing", async () => {
    await activate(); for (let index = 0; index < 3; index++) await assessment(hash(`daily-${index}`), 500000); await assessment(hash("daily-last"), 460000);
    expect((await ledger.status()).testing!.dailyReservedMicros).toBe(1970000);
    await expect(ledger.estimateWordPressAlt(altInput())).rejects.toBeDefined();
  });
  it("fails closed on a corrupt grant without rewriting historical rows", async () => {
    await activate(); ledger.onModuleDestroy(); const db = new DatabaseSync(path);
    try { db.prepare("UPDATE muse_wordpress_alt_funding SET checksum=? WHERE id=1").run("c".repeat(64)); } finally { db.close(); }
    await expect(ledger.status()).rejects.toBeDefined();
    await expect(ledger.estimateWordPressAlt(altInput())).rejects.toBeDefined();
  });

  it.each(["completed", "network-unknown"])("automatically accounts the v2 provider through the shared allowance with %s mock transport", async outcome => {
    const text = "Gráfico de Guzman Tax Accounting sobre ayuda con cartas del IRS.";
    const evidence: AltEvidence = { id: contextId, kind: "evidence", businessId, actor: operator, siteUrl: "https://example.com", capability: "wordpress.media.alt_text.update",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString(), source: { reportId: randomUUID(), findingId: "review", evidenceId: randomUUID(), reportHash: hash("source") },
      target: { mediaId: 7, pageResource: "pages", pageId: 9, sourceUrl: "https://example.com/full.png", pageUrl: "https://example.com/page/", currentAlt: "", modified: "2026-11-02T00:00:00" },
      purpose: "informative", verifiedDescription: text, descriptionProvenance: "operator-confirmed-text; no model visual inspection",
      proposalContext: { version: "wordpress-alt-context-v2", language: "es", requiredTerms: ["ayuda", "cartas", "IRS"], business: { id: businessId, name: "Guzman Tax Accounting", website: "https://example.com" },
        page: { id: 9, resource: "pages", url: "https://example.com/page/", title: "Bookkeeping", textExcerpt: "Ayuda con cartas del IRS.", collectedAt: new Date().toISOString() } } };
    const input = buildAltModelInput(evidence, "Español conciso."), transport = jest.fn<MetaMuseTransport["post"]>();
    transport.mockImplementation(async () => {
      if (outcome === "network-unknown") throw new Error("Offline mock transport lost its response");
      return { status: 200, requestId: "offline-provider-alt", body: JSON.stringify({ model: "muse-spark-1.3", status: "completed",
        output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ schemaVersion: "wordpress-alt-output-v1", status: "proposed", altText: text, reason: "DESCRIPTION_EXCERPT" }) }] }],
        usage: { input_tokens: 100, output_tokens: 40, output_tokens_details: { reasoning_tokens: 20 } } }) };
    });
    const provider = new MetaMuseProvider(new ConfigService({ MOCK_AI: false, AI_MODE: "poc", AI_ENABLED: true, AI_DEV_BUDGET_MICROS: 0, AI_DEV_DAILY_MICROS: 0, AI_DEV_MAX_CALLS: 0,
      MODEL_API_KEY: "offline-model-fixture-key", AI_MODEL: "muse-spark-1.3", AI_MAX_OUTPUT_TOKENS: 1500, AI_CONTROLLED_TESTING: true }), { post: transport }, ledger);
    const prepared = provider.prepare(input);
    expect(prepared.reserveMicros).toBeLessThanOrEqual(33615);
    const scope = `wordpress-alt:${businessId}:${contextId}`, intent = await provider.estimate(input, { actor: operator, scope, reason: "Explicit one-request offline provider pipeline fixture" });
    expect(intent.approvedBy).toBe(operator);
    const authorization = { actor: operator, scope, intentId: intent.id };
    if (outcome === "completed") {
      const result = await provider.generate(input, undefined, authorization);
      expect(validateAltOutput(result.output, evidence).altText).toBe(text);
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
      expect(result.diagnostics?.reasoningTokens).toBe(20);
    } else {
      await expect(provider.generate(input, undefined, authorization)).rejects.toMatchObject({ code: "AI_NETWORK_ERROR" });
    }
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(prepared.payload);
    const state = await ledger.status(), attempt = state.recentAttempts.find(row => row.intentId === intent.id)!;
    expect(attempt.status).toBe(outcome === "completed" ? "success" : "unknown");
    expect(attempt.chargedMicros).toBe(outcome === "completed" ? 295 : prepared.reserveMicros);
    expect(state.development).toMatchObject({ budgetMicros: 25000000, chargedMicros: 145008 + attempt.chargedMicros, calls: 6 });
    expect(state.testing).toMatchObject({ calls: 1, chargedMicros: 0 });
    expect(state.wordPressAlt).toBeUndefined(); // No feature-specific funding amendment was needed.
    expect(state.halted).toBe(outcome !== "completed");
    await expect(provider.generate(input, undefined, authorization)).rejects.toBeDefined();
    await expect(provider.estimate(input, { actor: operator, scope, reason: "Another explicit request needs no hash reauthorization" })).resolves.toMatchObject({ approvedBy: operator });
    expect(transport).toHaveBeenCalledTimes(1);

  });
});
