import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import type { WordPressService } from "../src/modules/wordpress/wordpress.service.js";
import type { WordPressFixService } from "../src/modules/wordpress/wordpress-fix.service.js";
import type { WordPressFixStore } from "../src/modules/wordpress/wordpress-fix.store.js";
import { WordPressFixCandidatesService } from "../src/modules/wordpress/wordpress-fix-candidates.service.js";
import { ALT_CAPABILITY, type AltEvidence } from "../src/modules/wordpress/wordpress-fix.types.js";
import { observeImages } from "../src/integrations/wordpress/image-evidence.js";

const businessId = "candidate-fixture", actor = "a".repeat(64), site = "https://example.com";
function fixture(mediaId = 7) {
  const reportId = randomUUID(), evidenceId = randomUUID(), findingId = randomUUID(), now = new Date().toISOString();
  const target = { mediaId, pageId: 9, pageResource: "pages" as const, sourceUrl: `${site}/image-${mediaId}.png`, pageUrl: `${site}/page/`, currentAlt: "", modified: "2026-11-02T00:00:00" };
  const variant = `${site}/registered-${mediaId}.webp`;
  const binding = { version: "wordpress-page-media-v1", businessId, siteUrl: site, target,
    sourceUrls: [target.sourceUrl, variant], mediaParentId: 9, pageModified: "2026-11-02T00:00:00",
    metadataCollectedAt: now, publicCollectedAt: now, publicHtmlHash: "b".repeat(64), renderedUrls: [variant] };
  const evidence = { id: evidenceId, auditId: reportId, checkId: "image-alt", mode: "live", sourceUrl: target.pageUrl, collectedAt: now,
    observed: { wordpressMediaBinding: JSON.stringify(binding), pageTitle: "Help with IRS letters", pageLanguage: "en",
      values: JSON.stringify(observeImages(`<img class="wp-image-${mediaId}" src="data:image/png;base64,AAAA" data-src="${variant}" alt="">`)) } };
  const report = { reportId, business: { id: businessId, website: site }, audit: { businessId, scope: "wordpress-page", mode: "live" },
    results: { findings: [{ id: findingId, checkId: "image-alt", source: "website", status: "needs_review", evidenceIds: [evidenceId] }], evidence: [evidence] } };
  const owner = (purpose: AltEvidence["purpose"]): AltEvidence => ({ id: randomUUID(), kind: "evidence", businessId, actor, siteUrl: site,
    createdAt: now, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), capability: ALT_CAPABILITY, target,
    source: { reportId, findingId, evidenceId, reportHash: "c".repeat(64) }, purpose,
    verifiedDescription: "A reviewed informative image about help understanding IRS letters.", descriptionProvenance: "operator-confirmed-text; no model visual inspection" });
  return { report, binding, evidence, target, reportId, evidenceId, findingId, owner };
}

describe("saved exact WordPress image-alt candidates, no provider calls", () => {
  let f: ReturnType<typeof fixture>;
  const artifacts = jest.fn<(...args: unknown[]) => unknown[]>();
  const workflows = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const capability = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const owners = jest.fn<(...args: unknown[]) => unknown[]>();
  let service: WordPressFixCandidatesService;
  beforeEach(() => {
    jest.clearAllMocks(); f = fixture();
    artifacts.mockImplementation(() => [{ id: f.reportId, payload: f.report }]);
    workflows.mockResolvedValue({ items: [] }); owners.mockReturnValue([]);
    capability.mockResolvedValue({ capability: ALT_CAPABILITY, fixable: true, workflow: { generationApproval: { status: "approved" } } });
    service = new WordPressFixCandidatesService({ listArtifacts: artifacts } as unknown as AppDatabase,
      { reportSite: async () => site } as unknown as WordPressService,
      { workflows, capability } as unknown as WordPressFixService, { list: owners } as unknown as WordPressFixStore,
      new ConfigService({ MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, WORDPRESS_WRITES_ENABLED: false }));
  });
  const updateBinding = () => { f.evidence.observed.wordpressMediaBinding = JSON.stringify(f.binding); };

  it("surfaces an authoritative lazy/responsive variant as an unreviewed empty-alt observation, never a confirmed defect", async () => {
    const result = await service.list(businessId, actor);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ reportId: f.reportId, findingId: f.findingId, evidenceId: f.evidenceId, target: f.target,
      pageTitle: "Help with IRS letters", pageLanguage: "en", purposeStatus: "unreviewed", requiresPurposeConfirmation: true,
      isMock: false, capability: { fixable: false, liveGenerationAllowed: false } });
    expect(capability).not.toHaveBeenCalled(); expect(result.modelCalls).toBe(0); expect(result.wordPressWrites).toBe(0);
  });
  it("retains a confirmed informative purpose without silently making mock operation a live request", async () => {
    owners.mockReturnValue([f.owner("informative")]);
    const result = await service.list(businessId, actor);
    expect(result.items[0]).toMatchObject({ purposeStatus: "informative", requiresPurposeConfirmation: false,
      capability: { fixable: true, liveGenerationAllowed: false } });
    expect(capability).toHaveBeenCalledWith(businessId, actor, f.reportId, f.findingId);
  });
  it("excludes owner-confirmed decorative/redundant imagery with intentionally empty alt", async () => {
    owners.mockReturnValue([f.owner("decorative")]);
    expect((await service.list(businessId, actor)).items).toHaveLength(0);
  });
  it.each(["public_verified", "outcome_unknown"])("never offers completed media5659 again after %s execution", async status => {
    f = fixture(5659);
    workflows.mockResolvedValue({ items: [{ workflow: { status, proposal: { resourceId: 5659, executionStarted: true, outcome: status === "public_verified" ? { status: "applied" } : null } } }] });
    expect((await service.list(businessId, actor)).items).toHaveLength(0);
  });
  it.each(["business", "site", "page", "parent", "variant", "current-alt", "stale"])("rejects an invalid %s evidence binding", async kind => {
    if (kind === "business") f.binding.businessId = "foreign";
    if (kind === "site") f.binding.siteUrl = "https://foreign.example";
    if (kind === "page") f.evidence.sourceUrl = `${site}/unrelated/`;
    if (kind === "parent") f.binding.mediaParentId = 100;
    if (kind === "variant") f.binding.renderedUrls = [`${site}/unregistered-asset.png`];
    if (kind === "current-alt") f.binding.target.currentAlt = "Already described";
    if (kind === "stale") f.binding.metadataCollectedAt = new Date(Date.now() - 8 * 86400000).toISOString();
    updateBinding(); expect((await service.list(businessId, actor)).items).toHaveLength(0);
  });
  it("rejects malformed authority data and historical homepage evidence rather than fabricating associations", async () => {
    f.evidence.observed.wordpressMediaBinding = "not-json";
    expect((await service.list(businessId, actor)).items).toHaveLength(0);
    updateBinding(); f.report.audit.scope = "homepage";
    expect((await service.list(businessId, actor)).items).toHaveLength(0);
  });
  it("returns one newest saved candidate per exact media/page", async () => {
    artifacts.mockImplementation(() => [{ id: f.reportId, payload: f.report }, { id: f.reportId, payload: structuredClone(f.report) }]);
    expect((await service.list(businessId, actor)).items).toHaveLength(1);
  });
});
