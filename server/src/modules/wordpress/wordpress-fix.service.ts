import { BadGatewayException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FileReportStore } from "../../reports/file-report.store.js";
import { MetaMuseProvider } from "../../integrations/ai/meta-muse.provider.js";
import { verifyImageAlt } from "../../integrations/wordpress/verify-image-alt.js";
import { WordPressService } from "./wordpress.service.js";
import { WordPressVerificationService } from "./wordpress-verification.service.js";
import { WordPressFixStore, fixDigest } from "./wordpress-fix.store.js";
import { ALT_CAPABILITY, altEvidenceSchema, altInstructions, altOutputSchema, enrollAltSchema, fixTargetSchema, generateAltSchema, validateAltOutput, type AltEvidence } from "./wordpress-fix.types.js";
const generationSchema = z.object({ id: z.string().uuid(), kind: z.literal("generation"), businessId: z.string(), actor: z.string(), siteUrl: z.string(), createdAt: z.string(), evidenceId: z.string().uuid(),
  inputHash: z.string(), requestHash: z.string(), isMock: z.boolean(), provider: z.enum(["mock-fixture", "meta"]), model: z.string(), output: altOutputSchema,
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }), requestId: z.string().nullable(), attemptId: z.string().optional() }).strict();
const revisionSchema = z.object({ id: z.string().uuid(), kind: z.literal("proposal"), businessId: z.string(), actor: z.string(), siteUrl: z.string(), createdAt: z.string(),
  evidenceId: z.string().uuid(), generationId: z.string().uuid(), proposalHash: z.string(), target: fixTargetSchema, originalAlt: z.string(), proposedAlt: z.string(),
  restorationOf: z.string().uuid().nullable() }).strict();
const unavailable = (message: string) => new ConflictException({ code: "WORDPRESS_FIX_NOT_ELIGIBLE", message });
const publicRecord = <T extends { actor: string }>(record: T): Omit<T, "actor"> => { const { actor: _actor, ...view } = record; void _actor; return view; };

@Injectable()
export class WordPressFixService {
  constructor(private readonly wordpress: WordPressService, private readonly reports: FileReportStore, private readonly store: WordPressFixStore,
    private readonly provider: MetaMuseProvider, private readonly config: ConfigService, private readonly verification: WordPressVerificationService) {}
  private async source(businessId: string, reportId: string, findingId: string, evidenceId: string) {
    const report = await this.reports.read(reportId);
    if (!report || report.business.id !== businessId || report.audit.businessId !== businessId || report.audit.mode !== "live" || !report.results) throw unavailable("A saved live report belonging to this business is required.");
    const finding = report.results.findings.find(row => row.id === findingId && row.checkId === "image-alt" && row.status === "needs_review" && row.evidenceIds.includes(evidenceId));
    const evidence = report.results.evidence.find(row => row.id === evidenceId && row.auditId === reportId && row.mode === "live" && row.checkId === "image-alt");
    if (!finding || !evidence || !Number.isFinite(Date.parse(evidence.collectedAt)) || Date.now() - Date.parse(evidence.collectedAt) > 7 * 86400000 || Date.parse(evidence.collectedAt) > Date.now() + 60000) throw unavailable("Exact current image-alt finding/evidence is unavailable or stale.");
    return { report, finding, evidence };
  }
  private async evidence(businessId: string, actor: string, id: string) {
    const record = altEvidenceSchema.parse(this.store.read(businessId, actor, id));
    if (record.siteUrl !== await this.wordpress.reportSite(businessId) || Date.parse(record.expiresAt) <= Date.now()) throw unavailable("The reviewed media context expired or the installation changed. Reconfirm evidence.");
    const source = await this.source(businessId, record.source.reportId, record.source.findingId, record.source.evidenceId);
    if (fixDigest(source.report) !== record.source.reportHash) throw unavailable("Source report changed.");
    return record;
  }
  private async current(record: AltEvidence, expected = record.target, allowAltMismatch = false) {
    const fresh = await this.wordpress.altTarget(record.businessId, expected.mediaId, expected.pageResource, expected.pageId);
    if (JSON.stringify(fresh.target) !== JSON.stringify(expected)) throw unavailable("The media or page binding changed; review fresh evidence before proceeding.");
    const match = verifyImageAlt(fresh.pageHtml, { mediaId: expected.mediaId, sourceUrl: expected.sourceUrl, pageUrl: expected.pageUrl, expectedAlt: expected.currentAlt });
    if (match.status === "inconclusive" || !allowAltMismatch && match.status !== "verified") throw unavailable("The page image cannot be matched unambiguously to the editable media and stored alternative.");
    return fresh;
  }
  /** Private operator attests image purpose/content; browser preferences cannot create evidence. */
  async enroll(businessId: string, actor: string, input: unknown) {
    const body = enrollAltSchema.parse(input);
    const siteUrl = await this.wordpress.reportSite(businessId);
    const source = await this.source(businessId, body.reportId, body.findingId, body.evidenceId);
    const fresh = await this.wordpress.altTarget(businessId, body.mediaId, body.pageResource, body.pageId);
    const images = z.array(z.object({ src: z.string().nullable(), alt: z.string().nullable() })).max(5000).parse(JSON.parse(source.evidence.observed.values ?? "null"));
    const matching = images.filter(image => {
      try { return !!image.src && new URL(image.src, source.evidence.sourceUrl).href === fresh.target.sourceUrl; } catch { return false; }
    });
    if (!matching.length || matching.some(image => image.alt !== fresh.target.currentAlt)
      || new URL(source.evidence.sourceUrl).href !== fresh.target.pageUrl) throw unavailable("Saved finding does not establish this exact media source, page and before-value. Filename guesses are not accepted.");
    const record: AltEvidence = altEvidenceSchema.parse({ id: randomUUID(), kind: "evidence", businessId, actor, siteUrl, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      capability: ALT_CAPABILITY, source: { reportId: body.reportId, findingId: body.findingId, evidenceId: body.evidenceId, reportHash: fixDigest(source.report) }, target: fresh.target,
      purpose: body.purpose, verifiedDescription: body.verifiedDescription, descriptionProvenance: "operator-confirmed-text; no model visual inspection" });
    await this.current(record);
    return publicRecord(this.store.publish(record));
  }
  async capability(businessId: string, actor: string, reportId: string, findingId: string) {
    const records = this.store.list(businessId, actor).filter(row => row.kind === "evidence").map(row => altEvidenceSchema.parse(row));
    const matches: AltEvidence[] = [];
    for (const record of records.filter(row => row.source.reportId === reportId && row.source.findingId === findingId)) {
      if (Date.parse(record.expiresAt) <= Date.now()) continue;
      await this.evidence(businessId, actor, record.id);
      if (!matches.some(row => row.target.mediaId === record.target.mediaId)) matches.push(record);
    }
    // A recommendation with more than one reviewed image needs a separately scoped finding.
    const record = matches.length === 1 ? matches[0] : undefined;
    const fixable = !!record && (record.purpose === "informative" && record.verifiedDescription.trim().length > 0 || record.purpose === "decorative" && record.target.currentAlt !== "");
    const saved = record ? this.store.list(businessId, actor).find(row => row.kind === "generation" && row.evidenceId === record.id) : null;
    const savedGeneration = saved ? generationSchema.parse(saved) : null;
    if (savedGeneration && record) validateAltOutput(savedGeneration.output, record);
    return { capability: ALT_CAPABILITY, fixable, reason: fixable ? "Exact operator-reviewed media context; fresh remote checks are required before proposal and Apply." : "No unique, current, writable media target with reliable image purpose/content has been reviewed. This recommendation remains manual.",
      savedGeneration: savedGeneration ? publicRecord(savedGeneration) : null,
      evidence: record ? publicRecord(record) : null, writesEnabled: [true, "true"].includes(this.config.get("WORDPRESS_WRITES_ENABLED") ?? false), limitations: ["Text-only Muse input; no image pixels are sent.", "Empty alt can be correct for decorative images.", "No score or ranking improvement is established."] };
  }
  private modelInput(evidence: AltEvidence, instructions: string) {
    return { instructions: altInstructions, input: { schemaVersion: "wordpress-alt-input-v1", capability: ALT_CAPABILITY, purpose: evidence.purpose,
      existingAlt: evidence.target.currentAlt, verifiedDescription: evidence.verifiedDescription, descriptionProvenance: evidence.descriptionProvenance,
      context: { reportId: evidence.source.reportId, evidenceId: evidence.source.evidenceId }, userPreferences: instructions }, schema: z.toJSONSchema(altOutputSchema) };
  }
  async preview(businessId: string, actor: string, input: unknown) {
    const body = generateAltSchema.parse(input), evidence = await this.evidence(businessId, actor, body.evidenceId);
    const prepared = this.provider.prepare(this.modelInput(evidence, body.instructions));
    const { payload: _payload, ...cost } = prepared; void _payload;
    return { ...cost, evidenceId: evidence.id, scope: `wordpress-alt:${businessId}:${evidence.id}`, noAuthorizationCreated: true };
  }
  async estimate(businessId: string, actor: string, input: unknown, reason: string) {
    const body = generateAltSchema.parse(input), evidence = await this.evidence(businessId, actor, body.evidenceId);
    return this.provider.estimate(this.modelInput(evidence, body.instructions), { actor, scope: `wordpress-alt:${businessId}:${evidence.id}`, reason });
  }
  async generate(businessId: string, actor: string, input: unknown) {
    const body = generateAltSchema.parse(input), evidence = await this.evidence(businessId, actor, body.evidenceId);
    await this.current(evidence);
    const modelInput = this.modelInput(evidence, body.instructions), prepared = this.provider.prepare(modelInput);
    const mock = ![false, "false"].includes(this.config.get("MOCK_AI") ?? true) || (this.config.get("AI_MODE") ?? "mock") === "mock";
    const inputHash = fixDigest({ evidenceId: evidence.id, requestHash: prepared.requestHash, mock });
    const cached = this.store.list(businessId, actor).find(row => row.kind === "generation" && row.inputHash === inputHash);
    if (cached) return publicRecord(generationSchema.parse(cached));
    const sufficient = evidence.purpose === "decorative" || evidence.purpose === "informative" && evidence.verifiedDescription.trim().length > 0;
    const local = !sufficient ? { schemaVersion: "wordpress-alt-output-v1", status: "insufficient_evidence", altText: null, reason: "INSUFFICIENT_CONTEXT" }
      : { schemaVersion: "wordpress-alt-output-v1", status: "proposed", altText: evidence.purpose === "decorative" ? "" : evidence.verifiedDescription.replace(/\s+/g, " ").trim().slice(0, 300), reason: evidence.purpose === "decorative" ? "DECORATIVE" : "DESCRIPTION_EXCERPT" };
    if (!mock && !sufficient) throw unavailable("No reliable image content/purpose exists; real generation is unnecessary and blocked.");
    const generation = mock ? { output: local, model: prepared.model, usage: { inputTokens: 0, outputTokens: 0 }, requestId: null }
      : await this.provider.generate(modelInput, undefined, { actor, scope: `wordpress-alt:${businessId}:${evidence.id}`, intentId: body.intentId ?? "" });
    if (generation.model !== prepared.model) throw new BadGatewayException("The proposal model did not match the prepared request.");
    let output;
    try { output = validateAltOutput(generation.output, evidence); } catch { throw new BadGatewayException({ code: "WORDPRESS_ALT_OUTPUT_INVALID", message: "Muse returned unsupported alt text. No proposal or write was created." }); }
    const record = generationSchema.parse({ id: randomUUID(), kind: "generation", businessId, actor, siteUrl: evidence.siteUrl, createdAt: new Date().toISOString(), evidenceId: evidence.id, inputHash,
      requestHash: prepared.requestHash, isMock: mock, provider: mock ? "mock-fixture" : "meta", model: generation.model, output, usage: generation.usage, requestId: generation.requestId,
      ...("attemptId" in generation && generation.attemptId ? { attemptId: generation.attemptId } : {}) });
    return publicRecord(this.store.publish(record));
  }
  async propose(businessId: string, actor: string, generationId: string, text: string) {
    const generation = generationSchema.parse(this.store.read(businessId, actor, generationId));
    const evidence = await this.evidence(businessId, actor, generation.evidenceId);
    if (generation.output.status !== "proposed") throw unavailable("Insufficient evidence cannot produce an executable proposal.");
    try { validateAltOutput({ ...generation.output, altText: text }, evidence); } catch { throw unavailable("Edited text must remain grounded in the verified image description/purpose."); }
    await this.current(evidence);
    const proposal = await this.wordpress.propose(businessId, actor, { resource: "media", resourceId: evidence.target.mediaId, changes: { altText: text } });
    if (proposal.before.altText !== evidence.target.currentAlt || proposal.modified !== evidence.target.modified) throw unavailable("Media changed while preparing the proposal. The unapproved proposal must not be used.");
    const revision = revisionSchema.parse({ id: proposal.id, kind: "proposal", businessId, actor, siteUrl: evidence.siteUrl, createdAt: proposal.createdAt,
      evidenceId: evidence.id, generationId, proposalHash: proposal.hash, target: evidence.target, originalAlt: proposal.before.altText, proposedAlt: text, restorationOf: null });
    this.store.publish(revision);
    return { ...publicRecord(proposal), capability: ALT_CAPABILITY, field: "alt_text", generation: publicRecord(generation), restorationOf: null };
  }
  async generation(businessId: string, actor: string, id: string) {
    const generation = generationSchema.parse(this.store.read(businessId, actor, id));
    const evidence = await this.evidence(businessId, actor, generation.evidenceId);
    validateAltOutput(generation.output, evidence);
    return publicRecord(generation);
  }
  private async revision(businessId: string, actor: string, id: string) {
    const record = this.store.read(businessId, actor, id);
    if (!record) throw new NotFoundException("Fix proposal not found.");
    const revision = revisionSchema.parse(record);
    if (revision.siteUrl !== await this.wordpress.reportSite(businessId)) throw unavailable("Installation changed.");
    const proposal = await this.wordpress.getProposal(businessId, actor, id);
    if (proposal.hash !== revision.proposalHash || proposal.resource !== "media" || proposal.resourceId !== revision.target.mediaId
      || Object.keys(proposal.changes).length !== 1 || proposal.changes.altText !== revision.proposedAlt || proposal.before.altText !== revision.originalAlt) throw new ServiceUnavailableException("Fix proposal binding failed.");
    return { revision, proposal };
  }
  async read(businessId: string, actor: string, id: string) {
    const { revision, proposal } = await this.revision(businessId, actor, id);
    return { ...publicRecord(proposal), capability: ALT_CAPABILITY, field: "alt_text", restorationOf: revision.restorationOf };
  }
  async apply(businessId: string, actor: string, id: string, hash: string) {
    const { revision, proposal } = await this.revision(businessId, actor, id);
    if (hash !== proposal.hash) throw unavailable("Approve the exact current proposal hash.");
    if (!proposal.outcome) {
      if (!revision.restorationOf) {
        const evidence = await this.evidence(businessId, actor, revision.evidenceId);
        await this.current(evidence, revision.target);
      } else {
        const evidence = altEvidenceSchema.parse(this.store.read(businessId, actor, revision.evidenceId));
        await this.current(evidence, revision.target, true);
      }
    }
    return this.wordpress.apply(businessId, actor, id, hash);
  }
  async verify(businessId: string, actor: string, id: string) {
    const { revision } = await this.revision(businessId, actor, id);
    const fresh = await this.wordpress.altTarget(businessId, revision.target.mediaId, revision.target.pageResource, revision.target.pageId);
    if (fresh.target.sourceUrl !== revision.target.sourceUrl || fresh.target.pageUrl !== revision.target.pageUrl) throw unavailable("The approved media/page identity changed; verification requires reconciliation.");
    const receipt = await this.verification.verify(businessId, actor, id, revision.target.pageResource, revision.target.pageId);
    return { receipt, status: !receipt.storedFieldMatches ? "stored_mismatch" : receipt.status === "verified" ? "public_verified" : receipt.status === "mismatch" ? "public_mismatch" : "stored_verified_public_inconclusive" };
  }
  async verificationReceipt(businessId: string, actor: string, id: string, verificationId: string) {
    await this.revision(businessId, actor, id);
    return this.verification.read(businessId, actor, id, verificationId);
  }
  async restore(businessId: string, actor: string, id: string) {
    const { revision, proposal: original } = await this.revision(businessId, actor, id);
    const outcome = z.object({ status: z.literal("applied"), verification: z.literal("verified_stored_fields"), storedModified: z.string() }).parse(original.outcome);
    if (revision.restorationOf) throw unavailable("Restoration is limited to the original applied change.");
    const fresh = await this.wordpress.altTarget(businessId, revision.target.mediaId, revision.target.pageResource, revision.target.pageId);
    if (fresh.target.sourceUrl !== revision.target.sourceUrl || fresh.target.pageUrl !== revision.target.pageUrl || fresh.target.currentAlt !== revision.proposedAlt || fresh.target.modified !== outcome.storedModified) throw unavailable("An intervening change prevents restoration. Reconcile; do not overwrite it.");
    const proposal = await this.wordpress.propose(businessId, actor, { resource: "media", resourceId: revision.target.mediaId, changes: { altText: revision.originalAlt } });
    if (proposal.before.altText !== revision.proposedAlt || proposal.modified !== outcome.storedModified) throw unavailable("Media changed during restoration preparation.");
    this.store.publish(revisionSchema.parse({ ...revision, id: proposal.id, createdAt: proposal.createdAt, proposalHash: proposal.hash, target: fresh.target,
      originalAlt: revision.proposedAlt, proposedAlt: revision.originalAlt, restorationOf: id }));
    return { ...publicRecord(proposal), capability: ALT_CAPABILITY, field: "alt_text", restorationOf: id };
  }
}
