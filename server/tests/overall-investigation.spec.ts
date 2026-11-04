import "reflect-metadata";
import { jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import { setImmediate as turn } from "node:timers/promises";
import type { Audit } from "../src/contracts/domain.js";
import type { BusinessRepository } from "../src/persistence/repositories.js";
import type { FileReportStore } from "../src/reports/file-report.store.js";
import type { AssessmentService } from "../src/modules/assessments/assessment.service.js";
import type { AuditsService } from "../src/modules/audits/audits.service.js";
import type { FacebookService } from "../src/modules/facebook/facebook.service.js";
import type { FacebookReportsService } from "../src/modules/facebook/facebook-reports.service.js";
import { OverallInvestigationService } from "../src/modules/facebook/overall-investigation.service.js";
import type { InvestigationAiService } from "../src/modules/investigation-ai/investigation-ai.service.js";

const owner = "a".repeat(64), other = "b".repeat(64), businessId = "business-1";
function fixture(interpretation?: InvestigationAiService) {
  const credential = jest.fn<FacebookService["credential"]>().mockResolvedValue({ token: "server-only", expiresAt: null, createdAt: new Date().toISOString() });
  const facebook = { credential } as unknown as FacebookService;
  const facebookCreate = jest.fn<FacebookReportsService["create"]>().mockResolvedValue({ auditId: "new-facebook", reportId: "new-facebook", generatedAt: new Date().toISOString(), fileName: "new-facebook.json", downloadUrl: "/report", status: "completed", failure: null });
  const facebookReports = { create: facebookCreate } as unknown as FacebookReportsService;
  const saved = { id: "new-website", businessId, status: "completed", results: { findings: [], recommendations: [] } } as unknown as Audit;
  const websiteCreate = jest.fn<AuditsService["create"]>().mockResolvedValue({ ...saved, counts: { findings: 0, recommendations: 0 }, statusUrl: "/api/audits/new-website" });
  const websiteGet = jest.fn<AuditsService["get"]>().mockResolvedValue(saved);
  const audits = { create: websiteCreate, get: websiteGet } as unknown as AuditsService;
  const previous = { business: { id: businessId }, audit: { businessId }, results: { facebook: { pageId: "123" } } };
  const list = jest.fn<FileReportStore["list"]>().mockResolvedValue([{ auditId: "old-facebook", scope: "facebook", mode: "live", status: "completed" }] as Awaited<ReturnType<FileReportStore["list"]>>);
  const read = jest.fn<FileReportStore["read"]>().mockResolvedValue(previous as Awaited<ReturnType<FileReportStore["read"]>>);
  const reports = { list, read } as unknown as FileReportStore;
  const assessment = { id: "new-assessment", snapshot: { scores: Object.fromEntries(["website", "social", "consistency", "overall"].map(name => [name, { availability: "available" }])) } };
  const assessmentCreate = jest.fn<AssessmentService["create"]>().mockResolvedValue(assessment as Awaited<ReturnType<AssessmentService["create"]>>);
  const assessments = { create: assessmentCreate } as unknown as AssessmentService;
  const findById = jest.fn<BusinessRepository["findById"]>().mockResolvedValue({ id: businessId, name: "Business", website: "https://example.com/", createdAt: new Date().toISOString() });
  const businesses = { findById } as unknown as BusinessRepository;
  const service = new OverallInvestigationService(facebook, facebookReports, audits, reports, assessments, businesses, interpretation);
  return { service, credential, facebookCreate, websiteCreate, websiteGet, assessmentCreate, list, read, previous, saved, assessment, findById };
}
async function completed(f: ReturnType<typeof fixture>) {
  for (let count = 0; count < 50; count++) {
    await turn();
    const status = await f.service.status(owner, businessId);
    if (status.latest) return status.latest;
  }
  throw new Error("Mock workflow did not finish");
}

describe("explicit overall investigation", () => {
  it("keeps polling active while the AI interpretation is pending", async () => {
    let release!: (value: Awaited<ReturnType<InvestigationAiService["interpret"]>>) => void;
    const interpret = jest.fn<InvestigationAiService["interpret"]>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const f = fixture({ interpret } as unknown as InvestigationAiService);
    await f.service.start(owner, businessId, { actor: owner, businessId, siteUrl: "https://example.com/" });
    for (let count = 0; count < 20 && !release; count++) await turn();
    expect(interpret).toHaveBeenCalledTimes(1);
    const pending = await f.service.status(owner, businessId);
    expect(pending.active?.audit).toMatchObject({ status: "running", stage: "preparing_recommendations" });
    expect(pending.latest).toBeNull();
    release({ status: "completed" } as Awaited<ReturnType<InvestigationAiService["interpret"]>>);
    expect((await completed(f)).audit.status).toBe("completed");
  });
  it("interprets the final saved report pair once after scoring, without running AI for the nested channel collections", async () => {
    const interpret = jest.fn<InvestigationAiService["interpret"]>().mockResolvedValue({ status: "completed" } as Awaited<ReturnType<InvestigationAiService["interpret"]>>);
    const f = fixture({ interpret } as unknown as InvestigationAiService);
    const context = { actor: "a".repeat(64), businessId, siteUrl: "https://example.com/" };
    await f.service.start(owner, businessId, context); const result = await completed(f);
    expect(result.audit.status).toBe("completed");
    expect(interpret).toHaveBeenCalledTimes(1); expect(interpret).toHaveBeenCalledWith(context, ["new-website", "new-facebook"]);
    expect(f.facebookCreate).toHaveBeenCalledWith(owner, businessId, "123");
    expect(f.websiteCreate).toHaveBeenCalledWith(businessId, "lighthouse", "mobile");
    expect(f.assessmentCreate.mock.invocationCallOrder[0]).toBeLessThan(interpret.mock.invocationCallOrder[0]);
    await f.service.status(owner, businessId); expect(interpret).toHaveBeenCalledTimes(1);
  });
  it("retains fresh reports/scores and exposes partial status when the AI step fails", async () => {
    const interpret = jest.fn<InvestigationAiService["interpret"]>().mockRejectedValue(new Error("private provider details"));
    const f = fixture({ interpret } as unknown as InvestigationAiService);
    await f.service.start(owner, businessId, { actor: "a".repeat(64), businessId, siteUrl: "https://example.com/" });
    const result = await completed(f);
    expect(result).toMatchObject({ websiteReportId: "new-website", facebookReportId: "new-facebook", assessmentId: "new-assessment", audit: { status: "partial", failure: { code: "AI_INTERPRETATION_FAILED" } } });
    expect(JSON.stringify(result)).not.toContain("private provider details"); expect(interpret).toHaveBeenCalledTimes(1);
  });
  it("refreshes the saved selected Page and website once, then pins both new reports", async () => {
    const f = fixture();
    const started = await f.service.start(owner, businessId);
    expect(["queued", "running"]).toContain(started.audit.status);
    const result = await completed(f);
    expect(f.facebookCreate).toHaveBeenCalledTimes(1);
    expect(f.facebookCreate).toHaveBeenCalledWith(owner, businessId, "123");
    expect(f.websiteCreate).toHaveBeenCalledWith(businessId, "lighthouse", "mobile");
    expect(f.assessmentCreate).toHaveBeenCalledWith(businessId, { websiteReportId: "new-website", facebookReportId: "new-facebook", profile: "baseline-mobile-v1" });
    expect(result).toMatchObject({ id: started.id, facebookReportId: "new-facebook", websiteReportId: "new-website", assessmentId: "new-assessment", audit: { status: "completed", stage: "complete" } });
    expect(JSON.stringify(result)).not.toContain("server-only");
  });
  it("makes no collections or score generation from status, and isolates browser outcomes", async () => {
    const f = fixture();
    expect(await f.service.status(owner, businessId)).toEqual({ businessId, active: null, latest: null });
    expect(f.facebookCreate).not.toHaveBeenCalled(); expect(f.websiteCreate).not.toHaveBeenCalled(); expect(f.assessmentCreate).not.toHaveBeenCalled();
    await f.service.start(owner, businessId); await completed(f);
    expect(await f.service.status(other, businessId)).toEqual({ businessId, active: null, latest: null });
    const status = await f.service.status(owner, businessId);
    status.latest!.audit.warnings.push("caller mutation");
    expect((await f.service.status(owner, businessId)).latest!.audit.warnings).toEqual([]);
  });
  it("rejects missing/expired credentials and unknown businesses before collection", async () => {
    const f = fixture(); f.credential.mockRejectedValue(new BadRequestException({ code: "FACEBOOK_SESSION_REQUIRED" }));
    await expect(f.service.start(undefined, businessId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.status(owner, businessId)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.facebookCreate).not.toHaveBeenCalled();
    const missing = fixture(); missing.findById.mockResolvedValue(null);
    await expect(missing.service.start(owner, businessId)).rejects.toThrow("Business not found");
    expect(missing.facebookCreate).not.toHaveBeenCalled();
  });
  it("reserves against duplicate starts even during asynchronous target lookup", async () => {
    const f = fixture(); let release!: () => void;
    f.facebookCreate.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return { auditId: "new-facebook", reportId: "new-facebook", generatedAt: new Date().toISOString(), fileName: "file", downloadUrl: "/report", status: "completed", failure: null }; });
    await f.service.start(owner, businessId); await turn();
    await expect(f.service.start(other, businessId)).rejects.toThrow("already running");
    expect((await f.service.status(other, businessId)).active).toBeNull();
    release(); await completed(f);
    expect(f.facebookCreate).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "wrong-business"])("refuses a %s saved Facebook target without provider calls", async mode => {
    const f = fixture();
    if (mode === "missing") f.list.mockResolvedValue([]); else f.previous.audit.businessId = "other-business";
    await f.service.start(owner, businessId);
    expect((await completed(f)).audit.failure?.code).toBe("FACEBOOK_TARGET_REQUIRED");
    expect(f.facebookCreate).not.toHaveBeenCalled(); expect(f.websiteCreate).not.toHaveBeenCalled(); expect(f.assessmentCreate).not.toHaveBeenCalled();
  });
  it("does not substitute an older Facebook report after fresh collection fails", async () => {
    const f = fixture(); f.facebookCreate.mockResolvedValue({ auditId: "failed-facebook", reportId: "failed-facebook", generatedAt: new Date().toISOString(), fileName: "file", downloadUrl: "/report", status: "failed", failure: { code: "FACEBOOK_COLLECTION_FAILED", message: "Failed" } });
    await f.service.start(owner, businessId);
    const result = await completed(f);
    expect(result.facebookReportId).toBe("failed-facebook"); expect(result.audit.status).toBe("failed");
    expect(f.websiteCreate).not.toHaveBeenCalled(); expect(f.assessmentCreate).not.toHaveBeenCalled();
  });
  it("retains new Facebook source when website fails and performs no score retry", async () => {
    const f = fixture(); f.saved.status = "failed";
    await f.service.start(owner, businessId);
    const result = await completed(f);
    expect(result).toMatchObject({ facebookReportId: "new-facebook", websiteReportId: "new-website", assessmentId: null, audit: { status: "failed" } });
    expect(f.assessmentCreate).not.toHaveBeenCalled(); expect(f.websiteCreate).toHaveBeenCalledTimes(1);
  });
  it("marks genuinely unavailable scores partial without inventing values", async () => {
    const f = fixture(); f.assessment.snapshot.scores.consistency!.availability = "unavailable";
    await f.service.start(owner, businessId);
    const result = await completed(f);
    expect(result.assessmentId).toBe("new-assessment");
    expect(result.audit).toMatchObject({ status: "partial", failure: { code: "ASSESSMENT_INCOMPLETE" } });
  });
  it("retains exact channel IDs if score publication fails, with no provider retry or unsafe detail", async () => {
    const f = fixture(); f.assessmentCreate.mockRejectedValue(new Error("private-storage-detail"));
    await f.service.start(owner, businessId);
    const result = await completed(f);
    expect(result.audit.status).toBe("failed"); expect(result.websiteReportId).toBe("new-website");
    expect(f.facebookCreate).toHaveBeenCalledTimes(1); expect(f.assessmentCreate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-storage-detail");
  });
  it("expires ephemeral outcomes and never replays them after restart", async () => {
    const f = fixture(); await f.service.start(owner, businessId); await completed(f);
    const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 3600001);
    try { expect((await f.service.status(owner, businessId)).latest).toBeNull(); } finally { now.mockRestore(); }
    const restarted = fixture(); expect((await restarted.service.status(owner, businessId)).latest).toBeNull(); expect(restarted.facebookCreate).not.toHaveBeenCalled();
  });
  it("bounds website waiting without starting another audit or scoring stale evidence", async () => {
    const f = fixture(); f.saved.status = "running";
    const deadline = new AbortController();
    const timeout = jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      await f.service.start(owner, businessId); await turn();
      deadline.abort(new DOMException("Test deadline", "TimeoutError"));
      const result = await completed(f);
      expect(result.audit.failure?.code).toBe("OVERALL_INVESTIGATION_TIMEOUT");
      expect(result.websiteReportId).toBe("new-website"); expect(result.assessmentId).toBeNull();
      expect(f.websiteCreate).toHaveBeenCalledTimes(1); expect(f.assessmentCreate).not.toHaveBeenCalled();
    } finally { timeout.mockRestore(); }
  });
  it("does not start a further channel on shutdown or accept new runs", async () => {
    const f = fixture(); await f.service.onModuleDestroy();
    await expect(f.service.start(owner, businessId)).rejects.toThrow("server is stopping");
    expect(f.facebookCreate).not.toHaveBeenCalled();
  });
});
