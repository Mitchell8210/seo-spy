import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { WordPressAltReceiptService, type AltReceiptOutcome } from "../src/modules/wordpress/wordpress-alt-receipt.service.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { WordPressFixStore } from "../src/modules/wordpress/wordpress-fix.store.js";

const actor = "a".repeat(64), admin = "b".repeat(64), hash = "c".repeat(64), businessId = "offline-business";
describe("settled WordPress-alt receipt publication without ledger or provider transports", () => {
  let service: WordPressAltReceiptService, outcome: AltReceiptOutcome, attempt: Record<string, unknown>, generation: Record<string, unknown>, evidence: Record<string, unknown>;
  let state: Record<string, unknown>;
  const usage = { status: jest.fn<() => Promise<unknown>>(), wordPressAltReceiptAuthority: jest.fn<(id: string) => Promise<unknown>>(), wordPressAltAttempt: jest.fn<(id: string) => Promise<unknown>>(),
    completeWordPressAltReceipt: jest.fn<(...args: unknown[]) => Promise<unknown>>() };
  const fixes = { read: jest.fn<(business: string, operator: string, id: string) => unknown>() };
  beforeEach(() => {
    jest.resetAllMocks();
    outcome = { businessId, actor, intentId: randomUUID(), evidenceId: randomUUID(), requestHash: hash, generationId: randomUUID(),
      schemaValid: true, persisted: true, httpStatus: 200, completionStatus: "completed", failureCategory: null };
    attempt = { id: randomUUID(), intent_id: outcome.intentId, status: "success", reserve_micros: 33615, charged_micros: 100,
      input_tokens: 10, output_tokens: 5, request_id: "offline-request" };
    state = { wordPressAlt: { funding: { adminActor: admin, request: { actor, businessId, evidenceContextId: outcome.evidenceId, requestHash: hash } } } };
    evidence = { id: outcome.evidenceId, kind: "evidence", businessId, actor, siteUrl: "https://example.com", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 1).toISOString(),
      capability: "wordpress.media.alt_text.update", source: { reportId: randomUUID(), findingId: "finding", evidenceId: randomUUID(), reportHash: hash },
      target: { mediaId: 7, pageResource: "pages", pageId: 9, sourceUrl: "https://example.com/photo.png", pageUrl: "https://example.com/page/", currentAlt: "", modified: "2026-11-02T00:00:00" },
      purpose: "informative", verifiedDescription: "A blue calculator beside a notebook.", descriptionProvenance: "operator-confirmed-text; no model visual inspection" };
    generation = { id: outcome.generationId, kind: "generation", businessId, actor, evidenceId: outcome.evidenceId, requestHash: hash, isMock: false, provider: "meta", attemptId: attempt.id,
      output: { schemaVersion: "wordpress-alt-output-v1", status: "proposed", altText: "A blue calculator", reason: "DESCRIPTION_EXCERPT" } };
    usage.status.mockImplementation(async () => state); usage.wordPressAltAttempt.mockImplementation(async () => attempt);
    usage.wordPressAltReceiptAuthority.mockImplementation(async () => {
      const grant = (state.wordPressAlt as { funding?: { adminActor: string; request: Record<string, unknown> } } | undefined)?.funding;
      return grant ? { ...grant.request, receiptActor: grant.adminActor } : null;
    });
    usage.completeWordPressAltReceipt.mockResolvedValue({});
    fixes.read.mockImplementation((_business, _actor, id) => id === outcome.evidenceId ? evidence : id === outcome.generationId ? generation : null);
    service = new WordPressAltReceiptService(usage as unknown as AiUsageStore, fixes as unknown as WordPressFixStore);
  });
  it("publishes authoritative settled usage using the funding administrator and a verified saved live generation", async () => {
    expect(await service.publish(outcome)).toBe(true);
    expect(usage.completeWordPressAltReceipt).toHaveBeenCalledWith(admin, outcome.intentId, { requestHash: hash, evidenceContextId: outcome.evidenceId,
      attemptId: attempt.id, reservedMicros: 33615, ledgerChargeMicros: 100, inputTokens: 10, outputTokens: 5, requestId: "offline-request",
      httpStatus: 200, completionStatus: "completed", schemaValid: true, persisted: true, generationId: outcome.generationId, failureCategory: null });
  });
  it.each(["no-grant", "no-attempt", "reserved"])("does not create a receipt for %s", async kind => {
    if (kind === "no-grant") state = {};
    if (kind === "no-attempt") usage.wordPressAltAttempt.mockResolvedValue(null);
    if (kind === "reserved") attempt.status = "reserved";
    expect(await service.publish(outcome)).toBe(false);
    expect(usage.completeWordPressAltReceipt).not.toHaveBeenCalled(); expect(fixes.read).not.toHaveBeenCalled();
  });
  it.each(["actor", "businessId", "evidenceId", "requestHash"])("rejects changed exact funding %s", async key => {
    const changed = { ...outcome, [key]: key === "evidenceId" ? randomUUID() : "wrong" };
    await expect(service.publish(changed)).rejects.toBeDefined();
    expect(usage.completeWordPressAltReceipt).not.toHaveBeenCalled();
  });
  it.each(["isMock", "provider", "actor", "businessId", "evidenceId", "requestHash", "attemptId", "output"])("rejects unsupported persisted generation %s", async key => {
    generation[key] = key === "isMock" ? true : key === "output" ? { schemaVersion: "wordpress-alt-output-v1", status: "proposed", altText: "Invented aircraft", reason: "DESCRIPTION_EXCERPT" } : "wrong";
    await expect(service.publish(outcome)).rejects.toBeDefined(); expect(usage.completeWordPressAltReceipt).not.toHaveBeenCalled();
  });
  it("retains an unknown outcome receipt despite a global halt, without pretending generation persistence", async () => {
    state.halted = true; attempt.status = "unknown"; attempt.charged_micros = 33615; attempt.input_tokens = null; attempt.output_tokens = null; attempt.request_id = null;
    expect(await service.publish({ ...outcome, generationId: null, schemaValid: false, persisted: false, httpStatus: null, completionStatus: null, failureCategory: "AI_USAGE_UNCERTAIN" })).toBe(true);
    expect(usage.completeWordPressAltReceipt).toHaveBeenCalledWith(admin, outcome.intentId, expect.objectContaining({ ledgerChargeMicros: 33615, persisted: false, generationId: null, failureCategory: "AI_USAGE_UNCERTAIN" }));
    expect(fixes.read).not.toHaveBeenCalled();
  });
  it("rejects a persisted generation without its exact provider attempt binding", async () => {
    delete generation.attemptId;
    await expect(service.publish(outcome)).rejects.toBeDefined();
    expect(usage.completeWordPressAltReceipt).not.toHaveBeenCalled();
  });
  it("does not retry receipt storage failure or silently release its lock", async () => {
    usage.completeWordPressAltReceipt.mockRejectedValue(new Error("Disposable storage failure"));
    await expect(service.publish(outcome)).rejects.toThrow("Disposable storage failure");
    expect(usage.completeWordPressAltReceipt).toHaveBeenCalledTimes(1);
  });
  it("rejects inconsistent persistence flags", async () => {
    await expect(service.publish({ ...outcome, persisted: false })).rejects.toBeDefined();
    await expect(service.publish({ ...outcome, generationId: null })).rejects.toBeDefined();
    expect(usage.completeWordPressAltReceipt).not.toHaveBeenCalled();
  });
});
