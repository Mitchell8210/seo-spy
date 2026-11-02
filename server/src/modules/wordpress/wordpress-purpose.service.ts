import { ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { load, loadBuffer } from "cheerio";
import { z } from "zod";
import { WebsiteCollector } from "../../integrations/website/collector.js";
import { WordPressImageContent } from "../../integrations/wordpress/image-content.js";
import { matchMediaImages, observeImages } from "../../integrations/wordpress/image-evidence.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import { WordPressService } from "./wordpress.service.js";
import { WordPressFixStore, fixDigest } from "./wordpress-fix.store.js";
import { altEvidenceSchema, type AltEvidence } from "./wordpress-fix.types.js";
import { pageMediaBindingSchema, pageSnapshot } from "./wordpress-page-evidence.service.js";
import { PURPOSE_POLICY_VERSION, deterministicPurposeBindingId, executionStateSchema, purposeBindingSchema, purposeDependencies,
  purposeDependencyHash, validatePurposeBinding, type ExecutionState } from "./wordpress-purpose.types.js";

const failed = (message: string) => new ConflictException({ code: "WORDPRESS_PURPOSE_DEPENDENCIES_CHANGED", message });
const materialChanged = () => new ConflictException({ code: "WORDPRESS_PURPOSE_REVIEW_CHANGED", message: "Image identity, association or reviewed context changed. Fresh owner confirmation is required." });
export const adoptPurposeSchema = z.object({ evidenceId: z.string().uuid(), originalReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  originalImageHash: z.string().regex(/^[a-f0-9]{64}$/), hashProvenance: z.string().trim().min(10).max(500), dependenciesUnchanged: z.literal(true) }).strict();
export const refreshPurposeStateSchema = z.object({ evidenceId: z.string().uuid(), confirmed: z.literal(true),
  source: z.object({ reportId: z.string().uuid(), findingId: z.string(), evidenceId: z.string().uuid() }).strict().optional() }).strict();
type SourceRef = AltEvidence["source"];
export const executionFactsHash = (record: AltEvidence) => fixDigest({ target: record.target, source: record.source,
  proposalContext: record.proposalContext ? { ...record.proposalContext, page: { ...record.proposalContext.page, collectedAt: undefined } } : null,
  purposeDependencyHash: record.purposeDependencyHash ?? null });

/** Durable consent provenance and independent immutable execution snapshots. No spending APIs. */
@Injectable()
export class WordPressPurposeService {
  constructor(private readonly wordpress: WordPressService, private readonly reports: FileReportStore, private readonly store: WordPressFixStore,
    private readonly collector: WebsiteCollector, private readonly images: WordPressImageContent) {}
  private owner(businessId: string, actor: string, id: string) { return altEvidenceSchema.parse(this.store.read(businessId, actor, id)); }
  hasBinding(owner: AltEvidence) { return this.store.read(owner.businessId, owner.actor, deterministicPurposeBindingId(owner.id)) !== null; }
  private assertLatest(owner: AltEvidence) {
    const latest = this.store.list(owner.businessId, owner.actor).filter(row => row.kind === "evidence").map(row => altEvidenceSchema.parse(row))
      .find(row => row.siteUrl === owner.siteUrl && row.target.mediaId === owner.target.mediaId && row.target.pageId === owner.target.pageId && row.target.pageResource === owner.target.pageResource);
    if (latest && latest.id !== owner.id) throw failed("A newer owner purpose/context decision supersedes this confirmation. No approval is transferred.");
  }
  binding(owner: AltEvidence) {
    this.assertLatest(owner);
    const binding = validatePurposeBinding(this.store.read(owner.businessId, owner.actor, deterministicPurposeBindingId(owner.id)), owner);
    if (this.store.list(owner.businessId, owner.actor).some(row => row.kind === "purpose-invalidation" && row.purposeBindingId === binding.id))
      throw failed("Material purpose dependencies changed. A fresh owner decision is required; timestamps will not be renewed.");
    return binding;
  }
  private async source(owner: AltEvidence, ref: Pick<SourceRef, "reportId" | "findingId" | "evidenceId">, freshRequired: boolean) {
    const report = await this.reports.read(ref.reportId);
    const finding = report?.results?.findings.find(row => row.id === ref.findingId && row.checkId === "image-alt" && row.status === "needs_review" && row.source === "website" && row.evidenceIds.includes(ref.evidenceId));
    const evidence = report?.results?.evidence.find(row => row.id === ref.evidenceId && row.auditId === ref.reportId && row.checkId === "image-alt" && row.mode === "live");
    if (!report || report.business.id !== owner.businessId || report.audit.businessId !== owner.businessId || report.audit.mode !== "live" || !finding || !evidence)
      throw failed("An exact owned immutable image finding and evidence are required.");
    if (new URL(report.business.website).hostname.replace(/^www\./, "") !== new URL(owner.siteUrl).hostname.replace(/^www\./, "")) throw failed("Source business website does not match the connected installation.");
    const age = Date.now() - Date.parse(evidence.collectedAt);
    if (!Number.isFinite(age) || age < -60000 || freshRequired && age > 7 * 86400000) throw failed("Execution source evidence is stale; explicitly collect fresh evidence. Owner purpose is retained.");
    return { report, evidence, ref: { ...ref, reportHash: fixDigest(report) } };
  }
  private async original(owner: AltEvidence) {
    if (owner.siteUrl !== await this.wordpress.reportSite(owner.businessId)) throw failed("Connected business/site changed.");
    const original = await this.source(owner, owner.source, false);
    if (original.ref.reportHash !== owner.source.reportHash) throw failed("Original confirmation source changed.");
    return original;
  }
  private page(fresh: Awaited<ReturnType<WordPressService["altTarget"]>>) {
    const $ = load(fresh.pageHtml); $("script,style,noscript").remove();
    const text = (value: string) => value.replace(/\s+/g, " ").trim();
    return { id: fresh.target.pageId, resource: fresh.target.pageResource, url: fresh.target.pageUrl,
      title: fresh.pageTitle ? text(load(fresh.pageTitle).text()).slice(0, 300) : null,
      textExcerpt: text($("h1,h2,p").toArray().slice(0, 10).map(element => $(element).text()).join(" ")).slice(0, 1200), collectedAt: fresh.metadataCollectedAt };
  }
  private async collect(owner: AltEvidence) {
    const checkedAt = new Date().toISOString();
    const fresh = await this.wordpress.altTarget(owner.businessId, owner.target.mediaId, owner.target.pageResource, owner.target.pageId);
    const image = await this.images.fingerprint(fresh.target.sourceUrl, owner.siteUrl);
    const page = await this.collector.collect(fresh.target.pageUrl, undefined, owner.siteUrl);
    if (page.status !== 200 || new URL(page.finalUrl).href !== fresh.target.pageUrl) throw failed("Exact public page unavailable.");
    const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(page.contentType)?.[1];
    const publicHtml = charset ? new TextDecoder(charset, { fatal: true }).decode(page.body) : page.body;
    const publicMatch = matchMediaImages(observeImages(publicHtml), page.finalUrl, [{ mediaId: owner.target.mediaId, sourceUrls: fresh.sourceUrls }], owner.target.mediaId);
    if (publicMatch.status !== "matched") throw materialChanged();
    const context = this.page(fresh), business = await this.wordpress.businessIdentity(owner.businessId);
    let dependencies: ReturnType<typeof purposeDependencies>;
    try {
      dependencies = purposeDependencies(owner, fresh, { sourceUrl: image.sourceUrl, sha256: image.sha256, bytes: image.bytes }, context, business);
      const $public = typeof publicHtml === "string" ? load(publicHtml) : loadBuffer(publicHtml);
      const publicDependencies = purposeDependencies(owner, { ...fresh, pageHtml: $public.html() },
        { sourceUrl: image.sourceUrl, sha256: image.sha256, bytes: image.bytes }, context, business);
      $public("script,style,noscript,header,footer,nav").remove();
      const material = $public("main").length ? $public("main").first() : $public("body");
      dependencies = { ...dependencies, publicPlacements: publicDependencies.placements,
        publicContextHash: fixDigest({ title: $public("title").text().replace(/\s+/g, " ").trim().slice(0, 300),
          text: material.find("h1,h2,p").toArray().slice(0, 10).map(element => $public(element).text()).join(" ").replace(/\s+/g, " ").trim().slice(0, 1200) }) };
    }
    catch { throw materialChanged(); }
    const urls = [...new Set([image.sourceUrl, ...dependencies.placements.flatMap(placement => placement.renderedUrls), ...publicMatch.renderedUrls])].sort();
    if (urls.length > 9) throw failed("Too many rendered variants for bounded content verification; no purpose reuse is granted.");
    const fingerprints = [{ sourceUrl: image.sourceUrl, sha256: image.sha256, bytes: image.bytes }];
    const remaining = urls.filter(url => url !== image.sourceUrl);
    for (let index = 0; index < remaining.length; index += 2) {
      const batch = await Promise.all(remaining.slice(index, index + 2).map(url => this.images.fingerprint(url, owner.siteUrl)));
      fingerprints.push(...batch.map(({ sourceUrl, sha256, bytes }) => ({ sourceUrl, sha256, bytes })));
      if (fingerprints.reduce((sum, file) => sum + file.bytes, 0) > 8 * 1024 * 1024) throw failed("Rendered image content exceeds the bounded verification budget.");
    }
    dependencies = { ...dependencies, renderedImages: fingerprints.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)) };
    const after = await this.wordpress.altTarget(owner.businessId, owner.target.mediaId, owner.target.pageResource, owner.target.pageId);
    if (fixDigest(pageSnapshot(fresh)) !== fixDigest(pageSnapshot(after))) throw failed("WordPress changed during the checks; no snapshot or owner renewal was published.");
    return { checkedAt, fresh, context, dependencies, publicMatch };
  }
  private validateExecutionSource(owner: AltEvidence, source: Awaited<ReturnType<WordPressPurposeService["source"]>>, checked: Awaited<ReturnType<WordPressPurposeService["collect"]>>) {
    const raw = source.evidence.observed.wordpressMediaBinding;
    if (!raw) throw failed("Execution requires exact page-scoped WordPress evidence, not a source URL alone.");
    const binding = pageMediaBindingSchema.parse(JSON.parse(raw));
    if (binding.businessId !== owner.businessId || binding.siteUrl !== owner.siteUrl || source.evidence.sourceUrl !== checked.fresh.target.pageUrl
      || binding.publicCollectedAt !== source.evidence.collectedAt || fixDigest(pageSnapshot(checked.fresh)) !== fixDigest({ target: binding.target, sourceUrls: binding.sourceUrls, mediaParentId: binding.mediaParentId, pageModified: binding.pageModified })
      || Math.abs(Date.parse(binding.metadataCollectedAt) - Date.parse(binding.publicCollectedAt)) > 120000
      || checked.publicMatch.matches.some(image => image.alt !== checked.fresh.target.currentAlt))
      throw failed("Execution before-value, source metadata or public alt changed. Collect current evidence; the owner decision is not retimestamped.");
    const observations = z.array(z.object({ src: z.string().nullable(), alt: z.string().nullable(), attributes: z.record(z.string(), z.string()),
      attachmentIds: z.array(z.number().int()), pictureSources: z.array(z.record(z.string(), z.string())) }).strict()).max(5000).parse(JSON.parse(source.evidence.observed.values ?? "null"));
    const recorded = matchMediaImages(observations, source.evidence.sourceUrl, [{ mediaId: owner.target.mediaId, sourceUrls: checked.fresh.sourceUrls }], owner.target.mediaId);
    if (recorded.status !== "matched" || recorded.matches.some(image => image.alt !== checked.fresh.target.currentAlt)) throw failed("Saved source observations do not establish this exact current media and before-value.");
  }
  /** Explicit adoption of an existing review, not another human purpose confirmation. */
  async adopt(businessId: string, actor: string, input: unknown) {
    const body = adoptPurposeSchema.parse(input), owner = this.owner(businessId, actor, body.evidenceId);
    this.assertLatest(owner); await this.original(owner);
    if (!["informative", "decorative"].includes(owner.purpose) || body.originalReviewHash !== fixDigest(owner)) throw failed("Only an exact informative/decorative owner confirmation can be adopted.");
    if (this.hasBinding(owner)) return { binding: this.binding(owner), alreadyAdopted: true, ownerConfirmationCreated: false };
    const checked = await this.collect(owner), source = await this.source(owner, owner.source, true);
    this.validateExecutionSource(owner, source, checked);
    if (checked.dependencies.image.sha256 !== body.originalImageHash) throw failed("Current image bytes differ from the original reviewed image fingerprint. Fresh owner confirmation is required.");
    const binding = purposeBindingSchema.parse({ id: deterministicPurposeBindingId(owner.id), kind: "purpose-binding", businessId, actor, siteUrl: owner.siteUrl,
      createdAt: new Date().toISOString(), policyVersion: PURPOSE_POLICY_VERSION, evidenceId: owner.id, originalReviewHash: fixDigest(owner),
      originalConfirmedAt: owner.createdAt, originalConfirmedBy: owner.actor, dependencyHash: purposeDependencyHash(checked.dependencies), dependencies: checked.dependencies,
      originalImageHash: body.originalImageHash, hashProvenance: body.hashProvenance });
    try { this.store.publish(binding); } catch { throw failed("Purpose adoption was already recorded or conflicted; no second confirmation was created."); }
    const state = this.publishState(owner, binding, source.ref, checked);
    return { binding, state, alreadyAdopted: false, ownerConfirmationCreated: false, originalConfirmedAt: owner.createdAt };
  }
  private publishState(owner: AltEvidence, binding: ReturnType<WordPressPurposeService["binding"]>, source: SourceRef, checked: Awaited<ReturnType<WordPressPurposeService["collect"]>>) {
    const expiresAt = new Date(Date.parse(checked.checkedAt) + 15 * 60000).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) throw failed("Read-only checks exceeded their execution validity window.");
    const state = executionStateSchema.parse({ id: randomUUID(), kind: "execution-state", businessId: owner.businessId, actor: owner.actor, siteUrl: owner.siteUrl,
      createdAt: checked.checkedAt, expiresAt, evidenceId: owner.id, purposeBindingId: binding.id, dependencyHash: binding.dependencyHash,
      target: checked.fresh.target, source,
      ...(owner.proposalContext ? { proposalContext: { ...owner.proposalContext, page: checked.context } } : {}) });
    this.store.publish(state); return state;
  }
  private async checked(owner: AltEvidence, binding: ReturnType<WordPressPurposeService["binding"]>) {
    const { businessId, actor, id } = owner;
    let checked: Awaited<ReturnType<WordPressPurposeService["collect"]>>;
    try { checked = await this.collect(owner); }
    catch (error) {
      if (error instanceof ConflictException && (error.getResponse() as { code?: string }).code === "WORDPRESS_PURPOSE_REVIEW_CHANGED") {
        this.store.publish({ id: randomUUID(), kind: "purpose-invalidation", businessId, actor, siteUrl: owner.siteUrl, createdAt: new Date().toISOString(), purposeBindingId: binding.id, evidenceId: id, reason: "material-context-changed" });
      }
      throw error;
    }
    if (purposeDependencyHash(checked.dependencies) !== binding.dependencyHash) {
      this.store.publish({ id: randomUUID(), kind: "purpose-invalidation", businessId, actor, siteUrl: owner.siteUrl, createdAt: new Date().toISOString(),
        purposeBindingId: binding.id, evidenceId: id, observedDependencyHash: purposeDependencyHash(checked.dependencies) });
      throw failed("Image, placement or reviewed context changed. A fresh owner confirmation is required.");
    }
    return checked;
  }
  /** Explicit or action-triggered read-only resource refresh. Never renews owner consent. */
  async refresh(businessId: string, actor: string, id: string, newSource?: Pick<SourceRef, "reportId" | "findingId" | "evidenceId">) {
    const owner = this.owner(businessId, actor, id), binding = this.binding(owner); await this.original(owner);
    try {
      const checked = await this.checked(owner, binding);
      const prior = this.latestState(owner, binding.id), source = await this.source(owner, newSource ?? prior?.source ?? owner.source, true);
      this.validateExecutionSource(owner, source, checked);
      const state = this.publishState(owner, binding, source.ref, checked);
      return { evidence: this.effective(owner, state, binding.dependencyHash), state, fresh: checked.fresh, ownerConfirmationRenewed: false };
    } catch (error) {
      this.store.publish({ id: randomUUID(), kind: "execution-invalidation", businessId, actor, siteUrl: owner.siteUrl,
        createdAt: new Date().toISOString(), evidenceId: id, purposeBindingId: binding.id, reason: "fresh-state-check-failed" });
      throw error;
    }
  }
  /** Diagnostic only: provider reads, but no consent/state/invalidation rows are written. */
  async inspect(businessId: string, actor: string, id: string) {
    const owner = this.owner(businessId, actor, id), binding = this.binding(owner); await this.original(owner);
    const checked = await this.collect(owner);
    if (purposeDependencyHash(checked.dependencies) !== binding.dependencyHash) throw materialChanged();
    const state = this.latestState(owner, binding.id), source = await this.source(owner, state?.source ?? owner.source, true);
    this.validateExecutionSource(owner, source, checked);
    return { evidenceId: id, revalidatedAt: checked.checkedAt, target: checked.fresh.target, source: source.ref,
      purposeReusable: true, purposeConfirmedAt: owner.createdAt, originalConfirmedBy: owner.actor,
      historicalReviewExpiresAt: owner.expiresAt, reviewExpired: false, reviewExpiresAt: null,
      executionStateExpiresAt: state?.expiresAt ?? null, executionRefreshRequired: !state || Date.parse(state.expiresAt) <= Date.now(),
      requiresNewOperatorConfirmation: false, eligibleForGeneration: !!state && Date.parse(state.expiresAt) > Date.now()
        && (owner.purpose === "informative" && !!owner.verifiedDescription.trim() || owner.purpose === "decorative" && checked.fresh.target.currentAlt !== ""),
      confirmationRenewed: false, applicationRecordsCreated: 0, modelRequests: 0, wordPressWrites: 0 };
  }
  async checkRestoration(owner: AltEvidence, expected: AltEvidence["target"]) {
    const binding = this.binding(owner); await this.original(owner);
    const checked = await this.checked(owner, binding);
    if (fixDigest(checked.fresh.target) !== fixDigest(expected))
      throw failed("Restoration identity/content or fresh before-state changed. No approval is reused.");
    return checked.fresh;
  }
  private latestState(owner: AltEvidence, bindingId: string): ExecutionState | undefined {
    const row = this.store.list(owner.businessId, owner.actor).find(row => row.kind === "execution-state" && row.purposeBindingId === bindingId);
    return row ? executionStateSchema.parse(row) : undefined;
  }
  private effective(owner: AltEvidence, state: ExecutionState, dependencyHash: string): AltEvidence {
    if (state.evidenceId !== owner.id || state.actor !== owner.actor || state.businessId !== owner.businessId || state.siteUrl !== owner.siteUrl || state.dependencyHash !== dependencyHash) throw failed("Execution snapshot binding failed.");
    return { ...owner, target: state.target, source: state.source, ...(state.proposalContext ? { proposalContext: state.proposalContext } : {}),
      expiresAt: state.expiresAt, purposeDependencyHash: dependencyHash };
  }
  async resolve(owner: AltEvidence, requireFresh = true): Promise<AltEvidence> {
    const binding = this.binding(owner); await this.original(owner);
    const state = this.latestState(owner, binding.id);
    if (!state) throw failed("Owner purpose is retained, but an explicit execution-state refresh is required.");
    const latestExecutionEvent = this.store.list(owner.businessId, owner.actor).find(row => row.purposeBindingId === binding.id
      && ["execution-state", "execution-invalidation"].includes(String(row.kind)));
    if (requireFresh && latestExecutionEvent?.kind === "execution-invalidation") throw failed("The last remote execution check failed. Refresh state; owner purpose was not renewed or revoked by a permission/alt failure.");
    if (Date.parse(state.createdAt) > Date.now() + 60000) throw failed("Execution-state clock is invalid; no approval is extended.");
    if (requireFresh && Date.parse(state.expiresAt) <= Date.now()) throw failed("Execution state expired. Refresh remote state; no new owner purpose confirmation is needed.");
    return this.effective(owner, state, binding.dependencyHash);
  }
}
