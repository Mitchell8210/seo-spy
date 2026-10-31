import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { WebsiteCollector, type CollectedPage } from "../src/integrations/website/collector.js";
import { WordPressActionsStore } from "../src/modules/wordpress/wordpress-actions.store.js";
import { WordPressService } from "../src/modules/wordpress/wordpress.service.js";
import { WordPressVerificationService } from "../src/modules/wordpress/wordpress-verification.service.js";

type Target = { siteUrl: string; pageUrl: string; sourceUrl: string; mediaId: number; expectedAlt: string; storedFieldMatches: boolean };
const businessId = "example";
const actor = "private-operator-identity";
const proposalId = randomUUID();

describe("public verification service with controlled collector fixtures", () => {
  let service: WordPressVerificationService;
  let target: Target;
  let records: Map<string, object>;
  let wordpress: {
    verificationTarget: ReturnType<typeof jest.fn<(...args: [string, string, string, "pages" | "posts", number]) => Promise<Target>>>;
    getProposal: ReturnType<typeof jest.fn<(...args: string[]) => Promise<unknown>>>;
    reportSite: ReturnType<typeof jest.fn<(businessId: string) => Promise<string>>>;
  };
  let store: {
    create: ReturnType<typeof jest.fn<WordPressActionsStore["create"]>>;
    read: ReturnType<typeof jest.fn<WordPressActionsStore["read"]>>;
  };
  let collector: { collect: ReturnType<typeof jest.fn<WebsiteCollector["collect"]>> };

  const page = (html: string, contentType = "text/html; charset=utf-8"): CollectedPage => ({
    requestedUrl: target.pageUrl, finalUrl: target.pageUrl, collectedAt: "2026-10-31T12:00:00.000Z",
    status: 200, contentType, robots: "", bytes: Buffer.byteLength(html), redirects: [], body: Buffer.from(html),
  });
  const verify = () => service.verify(businessId, actor, proposalId, "pages", 12);

  beforeEach(() => {
    target = { siteUrl: "https://example.com", pageUrl: "https://example.com/services/", sourceUrl: "https://example.com/uploads/team.jpg", mediaId: 7, expectedAlt: "Approved team alternative", storedFieldMatches: true };
    records = new Map();
    wordpress = {
      verificationTarget: jest.fn<(...args: [string, string, string, "pages" | "posts", number]) => Promise<Target>>().mockImplementation(async () => target),
      getProposal: jest.fn<(...args: string[]) => Promise<unknown>>().mockResolvedValue({ id: proposalId }),
      reportSite: jest.fn<(businessId: string) => Promise<string>>().mockImplementation(async () => target.siteUrl),
    };
    store = {
      create: jest.fn<WordPressActionsStore["create"]>().mockImplementation(async (id, kind, record) => { records.set(`${id}:${kind}`, structuredClone(record)); return true; }),
      read: jest.fn<WordPressActionsStore["read"]>().mockImplementation(async (id, kind) => structuredClone(records.get(`${id}:${kind}`) ?? null)),
    };
    collector = { collect: jest.fn<WebsiteCollector["collect"]>().mockImplementation(async () => page('<img class="wp-image-7" src="/uploads/team.jpg" alt="Approved team alternative"><div>Private HTML body excluded from receipts</div>')) };
    service = new WordPressVerificationService(wordpress as unknown as WordPressService, store as unknown as WordPressActionsStore, collector as unknown as WebsiteCollector);
  });

  it("collects only the adapter-bound public page and saves a receipt before returning verification", async () => {
    const result = await verify();
    expect(wordpress.verificationTarget).toHaveBeenCalledWith(businessId, actor, proposalId, "pages", 12);
    expect(collector.collect).toHaveBeenCalledWith(target.pageUrl, undefined, target.siteUrl);
    expect(result).toMatchObject({ version: "wordpress-public-verification-v1", proposalId, businessId, siteUrl: target.siteUrl, requestedUrl: target.pageUrl, finalUrl: target.pageUrl, storedFieldMatches: true, status: "verified", matchedImages: 1, observedAlts: [target.expectedAlt] });
    expect(result).not.toHaveProperty("actor");
    expect(store.create).toHaveBeenCalledTimes(1);
    expect(store.create.mock.calls[0][1]).toBe("verification");
    const saved = records.get(`${result.id}:verification`);
    expect(saved).toMatchObject({ actor, id: result.id });
    expect(JSON.stringify(saved)).not.toContain("Private HTML body");
    expect(JSON.stringify(result)).not.toContain(actor);
    expect(result.limitations.some(value => value.includes("ranking or performance"))).toBe(true);
  });

  it("keeps stored-field mismatch separate from a matching public value", async () => {
    target.storedFieldMatches = false;
    const result = await verify();
    expect(result).toMatchObject({ status: "verified", storedFieldMatches: false });
    expect(result.limitations.some(value => value.includes("stored alternative differs"))).toBe(true);
  });

  it("records a public cache mismatch and a separately requested delayed success without rewriting history", async () => {
    collector.collect.mockImplementationOnce(async () => page('<img class="wp-image-7" src="/uploads/team.jpg" alt="Old cached value">'));
    const original = await verify();
    expect(original.status).toBe("mismatch");
    const saved = structuredClone(records.get(`${original.id}:verification`));
    const later = await verify();
    expect(later.status).toBe("verified");
    expect(later.id).not.toBe(original.id);
    expect(records.get(`${original.id}:verification`)).toEqual(saved);
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it("persists inconclusive collection failures without raw provider errors or automatic retries", async () => {
    collector.collect.mockRejectedValue(new Error("secret-password and private-internal-path"));
    const result = await verify();
    expect(result).toMatchObject({ status: "inconclusive", finalUrl: null, collectedAt: null, matchedImages: 0, observedAlts: [] });
    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("secret-password");
    expect(result.limitations.some(value => value.includes("No automatic retry"))).toBe(true);
    expect(records.size).toBe(1);
  });

  it("honors transport charset and keeps unsupported or invalid byte encodings inconclusive", async () => {
    target.expectedAlt = "Equipo Español";
    collector.collect.mockImplementationOnce(async () => ({ ...page("", "text/html; charset=windows-1252"), body: Buffer.from('<img class="wp-image-7" src="/uploads/team.jpg" alt="Equipo Español">', "latin1") }));
    expect((await verify()).status).toBe("verified");
    collector.collect.mockImplementationOnce(async () => page('<img class="wp-image-7" src="/uploads/team.jpg" alt="Equipo Español">', "text/html; charset=unsupported-made-up-charset"));
    expect((await verify()).status).toBe("inconclusive");
    collector.collect.mockImplementationOnce(async () => ({ ...page(""), body: Buffer.from([0xff]) }));
    expect((await verify()).status).toBe("inconclusive");
  });

  it("reads persisted results with ownership/site checks and never recollects on polling", async () => {
    const result = await verify();
    collector.collect.mockClear();
    const saved = await service.read(businessId, actor, proposalId, result.id);
    expect(saved).toEqual(result);
    expect(wordpress.getProposal).toHaveBeenCalledWith(businessId, actor, proposalId);
    expect(wordpress.reportSite).toHaveBeenCalledWith(businessId);
    expect(collector.collect).not.toHaveBeenCalled();
    expect(store.create).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveProperty("actor");
  });

  it("rejects receipt owner, business, proposal and installation mismatches as unavailable records", async () => {
    const result = await verify();
    const stored = records.get(`${result.id}:verification`)!;
    for (const changes of [{ actor: "another-operator" }, { businessId: "another-business" }, { proposalId: randomUUID() }, { siteUrl: "https://other.example" }]) {
      records.set(`${result.id}:verification`, { ...stored, ...changes });
      await expect(service.read(businessId, actor, proposalId, result.id)).rejects.toMatchObject({ status: 404 });
    }
    await expect(service.read(businessId, actor, proposalId, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(collector.collect).toHaveBeenCalledTimes(1);
  });

  it("never collects when applied-target validation or proposal ownership fails", async () => {
    wordpress.verificationTarget.mockRejectedValue(new ForbiddenException("Not an applied owned media proposal"));
    await expect(verify()).rejects.toMatchObject({ status: 403 });
    expect(collector.collect).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    wordpress.getProposal.mockRejectedValue(new ForbiddenException("Proposal owner mismatch"));
    await expect(service.read(businessId, actor, proposalId, randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(store.read).not.toHaveBeenCalled();
  });

  it("fails closed if a verification receipt cannot be published or is corrupt", async () => {
    store.create.mockResolvedValueOnce(false);
    await expect(verify()).rejects.toMatchObject({ status: 503 });
    store.create.mockRejectedValueOnce(new Error("secret filesystem failure"));
    await expect(verify()).rejects.toThrow("The public verification receipt could not be saved or read safely.");
    const result = await verify();
    records.set(`${result.id}:verification`, { privateData: "not a receipt" });
    await expect(service.read(businessId, actor, proposalId, result.id)).rejects.toMatchObject({ status: 503 });
    store.read.mockRejectedValueOnce(new Error("secret path"));
    await expect(service.read(businessId, actor, proposalId, result.id)).rejects.toThrow("The public verification receipt could not be saved or read safely.");
  });
});
