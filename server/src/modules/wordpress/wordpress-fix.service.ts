import { BadGatewayException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { load } from "cheerio";
import { WebsiteCollector } from "../../integrations/website/collector.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import { MetaMuseError, MetaMuseProvider, type MetaMuseGeneration } from "../../integrations/ai/meta-muse.provider.js";
import { matchMediaImages, observeImages } from "../../integrations/wordpress/image-evidence.js";
import { pageMediaBindingSchema, pageSnapshot } from "./wordpress-page-evidence.service.js";
import { WordPressService } from "./wordpress.service.js";
import { WordPressVerificationService } from "./wordpress-verification.service.js";
import { WordPressFixStore, fixDigest } from "./wordpress-fix.store.js";
import { ALT_CAPABILITY, altEvidenceSchema, altOutputSchema, enrollAltSchema, fixTargetSchema, generateAltSchema, hasAltTerm, validateAltOutput, validateHumanAltText, type AltEvidence } from "./wordpress-fix.types.js";
import { buildAltModelInput } from "./wordpress-alt-request.js";
import { WordPressAltReceiptService, type AltReceiptOutcome } from "./wordpress-alt-receipt.service.js";
import { WordPressPurposeService, executionFactsHash } from "./wordpress-purpose.service.js";
const generationSchema = z.object({ id: z.string().uuid(), kind: z.literal("generation"), businessId: z.string(), actor: z.string(), siteUrl: z.string(), createdAt: z.string(), evidenceId: z.string().uuid(),
  inputHash: z.string(), requestHash: z.string(), isMock: z.boolean(), provider: z.enum(["mock-fixture", "meta"]), model: z.string(), output: altOutputSchema,
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }), requestId: z.string().nullable(), attemptId: z.string().optional(), executionFactsHash: z.string().optional() }).strict();
const revisionSchema = z.object({ id: z.string().uuid(), kind: z.literal("proposal"), businessId: z.string(), actor: z.string(), siteUrl: z.string(), createdAt: z.string(),
  evidenceId: z.string().uuid(), generationId: z.string().uuid(), proposalHash: z.string(), target: fixTargetSchema, originalAlt: z.string(), proposedAlt: z.string(),
  restorationOf: z.string().uuid().nullable(), executionFactsHash: z.string().optional(), textOrigin: z.literal("human-edited").optional() }).strict();
const unavailable = (message: string) => new ConflictException({ code: "WORDPRESS_FIX_NOT_ELIGIBLE", message });
const publicRecord = <T extends { actor: string }>(record: T): Omit<T, "actor"> => { const { actor: _actor, ...view } = record; void _actor; return view; };

@Injectable()
export class WordPressFixService {
  constructor(private readonly wordpress: WordPressService, private readonly reports: FileReportStore, private readonly store: WordPressFixStore,
    private readonly provider: MetaMuseProvider, private readonly config: ConfigService, private readonly verification: WordPressVerificationService,
    private readonly collector: WebsiteCollector, private readonly receipts: WordPressAltReceiptService, private readonly purposes: WordPressPurposeService) {}
  private async source(businessId: string, reportId: string, findingId: string, evidenceId: string) {
    const report = await this.reports.read(reportId);
    if (!report || report.business.id !== businessId || report.audit.businessId !== businessId || report.audit.mode !== "live" || !report.results) throw unavailable("A saved live report belonging to this business is required.");
    const finding = report.results.findings.find(row => row.id === findingId && row.checkId === "image-alt" && row.status === "needs_review" && row.evidenceIds.includes(evidenceId));
    const evidence = report.results.evidence.find(row => row.id === evidenceId && row.auditId === reportId && row.mode === "live" && row.checkId === "image-alt");
    if (!finding || !evidence || !Number.isFinite(Date.parse(evidence.collectedAt)) || Date.now() - Date.parse(evidence.collectedAt) > 7 * 86400000 || Date.parse(evidence.collectedAt) > Date.now() + 60000) throw unavailable("Exact current image-alt finding/evidence is unavailable or stale.");
    return { report, finding, evidence };
  }
  private async evidence(businessId: string, actor: string, id: string, requireFreshState = true): Promise<AltEvidence> {
    const original = altEvidenceSchema.parse(this.store.read(businessId, actor, id));
    const durable = !!this.purposes?.hasBinding(original);
    if (original.purposeValidity && !durable) throw unavailable("The evidence-bound purpose has no verified dependency binding. No legacy execution window is substituted.");
    const record = durable ? await this.purposes.resolve(original, requireFreshState) : original;
    if (record.siteUrl !== await this.wordpress.reportSite(businessId) || !durable && Date.parse(record.expiresAt) <= Date.now()) throw unavailable("The reviewed media context expired or the installation changed. Reconfirm evidence.");
    const source = await this.source(businessId, record.source.reportId, record.source.findingId, record.source.evidenceId);
    if (fixDigest(source.report) !== record.source.reportHash) throw unavailable("Source report changed.");
    if (record.proposalContext && (record.purpose !== "informative" || record.proposalContext.business.id !== businessId
      || record.proposalContext.business.name !== source.report.business.name || record.proposalContext.business.website !== source.report.business.website
      || record.proposalContext.page.id !== record.target.pageId || record.proposalContext.page.resource !== record.target.pageResource || record.proposalContext.page.url !== record.target.pageUrl
      || record.proposalContext.requiredTerms.some(term => !hasAltTerm(record.verifiedDescription, term)))) throw unavailable("Reviewed Spanish context is not bound to this source and target.");
    return record;
  }
  /** Explicit read-only revalidation, including expired contexts. Never renews or publishes confirmation. */
  async revalidate(businessId: string, actor: string, id: string) {
    const record = altEvidenceSchema.parse(this.store.read(businessId, actor, id));
    if (this.purposes?.hasBinding(record)) {
      return this.purposes.inspect(businessId, actor, id);
    }
    if (record.siteUrl !== await this.wordpress.reportSite(businessId)) throw unavailable("The installation changed.");
    const source = await this.source(businessId, record.source.reportId, record.source.findingId, record.source.evidenceId);
    if (fixDigest(source.report) !== record.source.reportHash) throw unavailable("Source report changed.");
    const fresh = await this.current(record);
    const page = await this.collector.collect(fresh.target.pageUrl, undefined, record.siteUrl);
    if (page.status !== 200 || new URL(page.finalUrl).href !== fresh.target.pageUrl) throw unavailable("Exact public page unavailable.");
    const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(page.contentType)?.[1];
    const html = charset ? new TextDecoder(charset, { fatal: true }).decode(page.body) : page.body;
    const matched = matchMediaImages(observeImages(html), page.finalUrl, [{ mediaId: record.target.mediaId, sourceUrls: fresh.sourceUrls }], record.target.mediaId);
    if (matched.status !== "matched" || matched.matches.some(image => image.alt !== record.target.currentAlt)) throw unavailable("Public image identity/current alternative changed.");
    const expired = Date.parse(record.expiresAt) <= Date.now();
    const purposeEligible = record.purpose === "informative" && record.verifiedDescription.trim().length > 0 || record.purpose === "decorative" && record.target.currentAlt !== "";
    return { evidenceId: id, revalidatedAt: new Date().toISOString(), target: fresh.target, source: record.source, sourceUrls: fresh.sourceUrls,
      pageContext: this.pageContext(fresh), publicCollectedAt: page.collectedAt, renderedUrls: matched.renderedUrls,
      purpose: record.purpose, reviewExpired: expired, reviewExpiresAt: record.expiresAt, requiresNewOperatorConfirmation: expired,
      eligibleForGeneration: !expired && purposeEligible, confirmationRenewed: false, modelRequests: 0, wordPressWrites: 0 };
  }
  private pageContext(fresh: Awaited<ReturnType<WordPressService["altTarget"]>>) {
    const $ = load(fresh.pageHtml); $("script,style,noscript").remove();
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    return { id: fresh.target.pageId, resource: fresh.target.pageResource, url: fresh.target.pageUrl,
      title: fresh.pageTitle ? normalize(load(fresh.pageTitle).text()).slice(0, 300) : null,
      textExcerpt: normalize($("h1,h2,p").toArray().slice(0, 10).map(element => $(element).text()).join(" ")).slice(0, 1200), collectedAt: fresh.metadataCollectedAt };
  }
  private async current(record: AltEvidence, expected = record.target, allowAltMismatch = false) {
    if (record.purposeDependencyHash || this.purposes?.hasBinding(record)) {
      const owner = altEvidenceSchema.parse(this.store.read(record.businessId, record.actor, record.id));
      if (allowAltMismatch) return { ...await this.purposes.checkRestoration(owner, expected), effectiveEvidence: undefined };
      const checked = await this.purposes.refresh(record.businessId, record.actor, record.id);
      if (fixDigest(checked.evidence.target) !== fixDigest(expected)) throw unavailable("The execution before-state changed. Refresh evidence and prepare a new exact request/proposal.");
      return { ...checked.fresh, effectiveEvidence: checked.evidence };
    }
    const fresh = await this.wordpress.altTarget(record.businessId, expected.mediaId, expected.pageResource, expected.pageId);
    if (JSON.stringify(fresh.target) !== JSON.stringify(expected)) throw unavailable("The media or page binding changed; review fresh evidence before proceeding.");
    const match = matchMediaImages(observeImages(fresh.pageHtml), expected.pageUrl, [{ mediaId: expected.mediaId, sourceUrls: fresh.sourceUrls }], expected.mediaId);
    if (match.status !== "matched" || !allowAltMismatch && match.matches.some(image => image.alt !== expected.currentAlt)) throw unavailable("The page image cannot be matched unambiguously to the editable media and stored alternative.");
    if (!allowAltMismatch) {
      const source = await this.source(record.businessId, record.source.reportId, record.source.findingId, record.source.evidenceId);
      this.assertPageBinding(source, fresh, record.siteUrl);
    }
    return { ...fresh, effectiveEvidence: undefined };
  }
  private assertPageBinding(source: Awaited<ReturnType<WordPressFixService["source"]>>, fresh: Awaited<ReturnType<WordPressService["altTarget"]>>, siteUrl: string) {
    const raw = source.evidence.observed.wordpressMediaBinding;
    if (source.report.audit.scope === "wordpress-page" && !raw) throw unavailable("Page-scoped evidence requires its exact immutable WordPress binding.");
    if (!raw) return;
    const binding = pageMediaBindingSchema.parse(JSON.parse(raw));
    if (source.report.audit.scope !== "wordpress-page" || binding.businessId !== source.report.business.id || binding.siteUrl !== siteUrl
      || binding.publicCollectedAt !== source.evidence.collectedAt || binding.target.pageUrl !== source.evidence.sourceUrl
      || !Number.isFinite(Date.parse(binding.metadataCollectedAt)) || Math.abs(Date.parse(binding.metadataCollectedAt) - Date.parse(binding.publicCollectedAt)) > 120000
      || fixDigest(pageSnapshot(fresh)) !== fixDigest({ target: binding.target, sourceUrls: binding.sourceUrls, mediaParentId: binding.mediaParentId, pageModified: binding.pageModified }))
      throw unavailable("Saved WordPress media/page metadata no longer matches the current exact target. Explicitly recollect; historical evidence will not be rewritten.");
  }
  /** Private operator attests image purpose/content; browser preferences cannot create evidence. */
  async enroll(businessId: string, actor: string, input: unknown) {
    const body = enrollAltSchema.parse(input);
    const siteUrl = await this.wordpress.reportSite(businessId);
    const source = await this.source(businessId, body.reportId, body.findingId, body.evidenceId);
    const fresh = await this.wordpress.altTarget(businessId, body.mediaId, body.pageResource, body.pageId);
    this.assertPageBinding(source, fresh, siteUrl);
    const images = z.array(z.object({ src: z.string().nullable(), alt: z.string().nullable() }).passthrough()).max(5000).parse(JSON.parse(source.evidence.observed.values ?? "null"));
    const matching = source.evidence.observed.wordpressMediaBinding
      ? (() => {
        const observations = z.array(z.object({ src: z.string().nullable(), alt: z.string().nullable(), attributes: z.record(z.string(), z.string()), attachmentIds: z.array(z.number().int()), pictureSources: z.array(z.record(z.string(), z.string())) }).strict()).max(5000).parse(images);
        const result = matchMediaImages(observations, source.evidence.sourceUrl, [{ mediaId: body.mediaId, sourceUrls: fresh.sourceUrls }], body.mediaId);
        if (result.status !== "matched") throw unavailable("Saved image variants or attachment identifiers are ambiguous.");
        return result.matches;
      })()
      : images.filter(image => {
        try { return !!image.src && new URL(image.src, source.evidence.sourceUrl).href === fresh.target.sourceUrl; } catch { return false; }
      });
    if (!matching.length || matching.some(image => image.alt !== fresh.target.currentAlt)
      || new URL(source.evidence.sourceUrl).href !== fresh.target.pageUrl) throw unavailable("Saved finding does not establish this exact media source, page and before-value. Filename guesses are not accepted.");
    if (body.proposalLanguage && (body.purpose !== "informative" || body.requiredTerms!.some(term => !hasAltTerm(body.verifiedDescription, term)))) throw unavailable("Spanish essential terms must be present in the explicitly reviewed informative description.");
    const record: AltEvidence = altEvidenceSchema.parse({ id: randomUUID(), kind: "evidence", businessId, actor, siteUrl, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      capability: ALT_CAPABILITY, source: { reportId: body.reportId, findingId: body.findingId, evidenceId: body.evidenceId, reportHash: fixDigest(source.report) }, target: fresh.target,
      purpose: body.purpose, verifiedDescription: body.verifiedDescription, descriptionProvenance: "operator-confirmed-text; no model visual inspection",
      ...(body.proposalLanguage ? { proposalContext: { version: "wordpress-alt-context-v2", language: body.proposalLanguage, requiredTerms: body.requiredTerms,
        business: { id: source.report.business.id, name: source.report.business.name, website: source.report.business.website }, page: this.pageContext(fresh) } } : {}),
      ...(body.durablePurpose ? { purposeValidity: "evidence-bound-v1" } : {}) });
    await this.current(record);
    this.store.publish(record);
    if (body.durablePurpose) await this.purposes.adopt(businessId, actor, { evidenceId: record.id, originalReviewHash: fixDigest(record),
      ...body.durablePurpose, dependenciesUnchanged: true });
    return publicRecord(record);
  }
  async workflows(businessId: string, actor: string) {
    const siteUrl = await this.wordpress.reportSite(businessId), rows = this.store.list(businessId, actor);
    const owners = rows.filter(row => row.kind === "evidence").map(row => altEvidenceSchema.parse(row)).filter(row => row.siteUrl === siteUrl);
    const items = [];
    for (const owner of owners) {
      const revisions = rows.filter(row => row.kind === "proposal" && row.evidenceId === owner.id).map(row => revisionSchema.parse(row));
      const proposals = await Promise.all(revisions.map(row => this.read(businessId, actor, row.id)));
      // A newer unused draft cannot turn an already executed fix into an unresolved action.
      const proposal = proposals.find(row => row.executionStarted || row.outcome) ?? proposals[0] ?? null;
      const revision = proposal ? revisions.find(row => row.id === proposal.id)! : null;
      const rawGeneration = revision ? this.store.read(businessId, actor, revision.generationId) : rows.find(row => row.kind === "generation" && row.evidenceId === owner.id);
      const generation = rawGeneration ? generationSchema.parse(rawGeneration) : null;
      if (generation) {
        if (generation.evidenceId !== owner.id) throw unavailable("Saved generation is bound to another owner review.");
        validateAltOutput(generation.output, owner);
      }
      const outcome = proposal?.outcome ? z.object({ status: z.string(), verification: z.string().optional() }).passthrough().parse(proposal.outcome) : null;
      const receipt = proposal && outcome?.status === "applied" ? await this.verification.latest(businessId, actor, proposal.id) : null;
      const verification = receipt ? { receipt, status: !receipt.storedFieldMatches ? "stored_mismatch" : receipt.status === "verified" ? "public_verified" : receipt.status === "mismatch" ? "public_mismatch" : "stored_verified_public_inconclusive" } : null;
      const status = proposal?.restorationOf && outcome?.status === "applied" ? "restored" : verification?.status ?? outcome?.status
        ?? (proposal?.executionStarted ? "outcome_unknown" : proposal ? Date.parse(proposal.expiresAt) <= Date.now() ? "expired" : "pending_approval" : "draft");
      let generationApproval: { status: "not_required" | "pending_approval" | "approved" | "expired" | "used"; intentId?: string } = { status: "not_required" };
      if ([false, "false"].includes(this.config.get("MOCK_AI") ?? true) && this.config.get("AI_MODE") !== "mock") {
        generationApproval = { status: proposal?.executionStarted || proposal?.outcome ? "used" : "pending_approval" };
        if (!proposal?.executionStarted && !proposal?.outcome) {
          try {
            const effective = this.purposes?.hasBinding(owner) ? await this.purposes.resolve(owner, false) : owner;
            generationApproval = await this.provider.wordPressAltApproval(this.modelInput(effective, ""), { actor, scope: `wordpress-alt:${businessId}:${owner.id}` });
          } catch { /* Changed dependencies or missing authorization remain pending; a GET never refreshes or approves them. */ }
        }
      }
      items.push({ reportId: owner.source.reportId, findingId: owner.source.findingId, evidenceId: owner.id,
        workflow: { status, proposal, generation: generation ? publicRecord(generation) : null, verification, pageUrl: owner.target.pageUrl,
          target: owner.target, pageTitle: owner.proposalContext?.page.title ?? null, completedAt: typeof outcome?.completedAt === "string" ? outcome.completedAt : null,
          approvalRequired: !!proposal && !proposal.executionStarted && !proposal.outcome, generationApproval } });
    }
    return { items };
  }
  async capability(businessId: string, actor: string, reportId: string, findingId: string) {
    const savedWorkflow = (await this.workflows(businessId, actor)).items.find(row => row.reportId === reportId && row.findingId === findingId);
    if (savedWorkflow?.workflow.proposal && !["pending_approval", "expired"].includes(savedWorkflow.workflow.status)) {
      const owner = altEvidenceSchema.parse(this.store.read(businessId, actor, savedWorkflow.evidenceId));
      return { capability: ALT_CAPABILITY, fixable: false, reason: "This saved operation has an execution record. Review its receipt; do not start it again.",
        evidence: publicRecord(owner), writesEnabled: this.config.get("WORDPRESS_WRITES_ENABLED") === true || this.config.get("WORDPRESS_WRITES_ENABLED") === "true",
        savedGeneration: savedWorkflow.workflow.generation, workflow: savedWorkflow.workflow, limitations: ["Saved receipts describe the measured result at their recorded time; viewing them makes no provider calls."] };
    }
    const records = this.store.list(businessId, actor).filter(row => row.kind === "evidence").map(row => altEvidenceSchema.parse(row));
    const matches: AltEvidence[] = [];
    let purposeReusable = false, refreshRequired = false;
    for (const original of records) {
      const durable = !!this.purposes?.hasBinding(original);
      if (original.purposeValidity && !durable) continue;
      let record = original;
      if (durable) {
        try { record = await this.purposes.resolve(original, false); }
        catch { continue; }
      }
      if (record.source.reportId !== reportId || record.source.findingId !== findingId) continue;
      if (durable) purposeReusable = true;
      if (durable) {
        try { await this.evidence(businessId, actor, original.id, true); }
        catch { refreshRequired = true; continue; }
      }
      if (Date.parse(record.expiresAt) <= Date.now()) { if (durable) refreshRequired = true; continue; }
      if (!durable) await this.evidence(businessId, actor, record.id);
      if (!matches.some(row => row.target.mediaId === record.target.mediaId)) matches.push(record);
    }
    // A recommendation with more than one reviewed image needs a separately scoped finding.
    const record = matches.length === 1 ? matches[0] : undefined;
    const fixable = !!record && (record.purpose === "informative" && record.verifiedDescription.trim().length > 0 || record.purpose === "decorative" && record.target.currentAlt !== "");
    const saved = record ? this.store.list(businessId, actor).find(row => row.kind === "generation" && row.evidenceId === record.id) : null;
    const savedGeneration = saved ? generationSchema.parse(saved) : null;
    if (savedGeneration && record) validateAltOutput(savedGeneration.output, record);
    return { capability: ALT_CAPABILITY, fixable, purposeReusable, executionRefreshRequired: refreshRequired, workflow: savedWorkflow?.workflow ?? null,
      reason: refreshRequired ? "Owner purpose is retained. Refresh read-only execution state; no new owner purpose confirmation is needed." : fixable ? "Exact operator-reviewed media context; fresh remote checks are required before proposal and Apply." : "No unique, current, writable media target with reliable image purpose/content has been reviewed. This recommendation remains manual.",
      savedGeneration: savedGeneration ? publicRecord(savedGeneration) : null,
      evidence: record ? publicRecord(record) : null, writesEnabled: [true, "true"].includes(this.config.get("WORDPRESS_WRITES_ENABLED") ?? false), limitations: ["Text-only Muse input; no image pixels are sent.", "Empty alt can be correct for decorative images.", "No score or ranking improvement is established."] };
  }
  private modelInput(evidence: AltEvidence, instructions: string) {
    return buildAltModelInput(evidence, instructions);
  }
  async prepareRequest(businessId: string, actor: string, input: unknown) {
    const body = generateAltSchema.parse(input), evidence = await this.evidence(businessId, actor, body.evidenceId);
    return this.provider.prepare(this.modelInput(evidence, body.instructions));
  }
  async preview(businessId: string, actor: string, input: unknown) {
    const body = generateAltSchema.parse(input), prepared = await this.prepareRequest(businessId, actor, body);
    const { payload: _payload, ...cost } = prepared; void _payload;
    return { ...cost, evidenceId: body.evidenceId, scope: `wordpress-alt:${businessId}:${body.evidenceId}`, noAuthorizationCreated: true };
  }
  async estimate(businessId: string, actor: string, input: unknown, reason: string) {
    const body = generateAltSchema.parse(input), evidence = await this.evidence(businessId, actor, body.evidenceId);
    return this.provider.estimate(this.modelInput(evidence, body.instructions), { actor, scope: `wordpress-alt:${businessId}:${evidence.id}`, reason });
  }
  async generate(businessId: string, actor: string, input: unknown) {
    const body = generateAltSchema.parse(input);
    let evidence = await this.evidence(businessId, actor, body.evidenceId, false);
    const checked = await this.current(evidence); evidence = checked.effectiveEvidence ?? evidence;
    if (Date.parse(evidence.expiresAt) <= Date.now()) throw unavailable("The review expired during the current resource checks. Explicit confirmation is required before generation.");
    const modelInput = this.modelInput(evidence, body.instructions), prepared = this.provider.prepare(modelInput);
    const mock = ![false, "false"].includes(this.config.get("MOCK_AI") ?? true) || (this.config.get("AI_MODE") ?? "mock") === "mock";
    const inputHash = fixDigest({ evidenceId: evidence.id, requestHash: prepared.requestHash, mock });
    const cached = this.store.list(businessId, actor).find(row => row.kind === "generation" && row.inputHash === inputHash);
    if (cached) return publicRecord(generationSchema.parse(cached));
    const sufficient = evidence.purpose === "decorative" || evidence.purpose === "informative" && evidence.verifiedDescription.trim().length > 0;
    const mockDescription = evidence.proposalContext ? evidence.verifiedDescription.split(/(?<=[.!?])\s+/).find(sentence => evidence.proposalContext!.requiredTerms.every(term => hasAltTerm(sentence, term))) ?? evidence.verifiedDescription : evidence.verifiedDescription;
    const local = !sufficient ? { schemaVersion: "wordpress-alt-output-v1", status: "insufficient_evidence", altText: null, reason: "INSUFFICIENT_CONTEXT" }
      : { schemaVersion: "wordpress-alt-output-v1", status: "proposed", altText: evidence.purpose === "decorative" ? "" : mockDescription.replace(/\s+/g, " ").trim().slice(0, 300), reason: evidence.purpose === "decorative" ? "DECORATIVE" : "DESCRIPTION_EXCERPT" };
    if (!mock && !sufficient) throw unavailable("No reliable image content/purpose exists; real generation is unnecessary and blocked.");
    let generation: MetaMuseGeneration | undefined, schemaValid = false, savedId: string | null = null, receiptAttempted = false;
    const publishReceipt = async (error?: unknown) => {
      if (mock || !evidence.proposalContext || !body.intentId) return;
      receiptAttempted = true;
      const diagnostics = error instanceof MetaMuseError ? error.diagnostics : undefined;
      const status = diagnostics?.responseStatus;
      const completionStatus: AltReceiptOutcome["completionStatus"] = generation ? "completed" : status && ["completed", "incomplete", "failed", "in_progress", "queued", "cancelled"].includes(status) ? status as AltReceiptOutcome["completionStatus"] : null;
      const receiptSaved = await this.receipts.publish({ businessId, actor, intentId: body.intentId, evidenceId: evidence.id, requestHash: prepared.requestHash,
        generationId: savedId, schemaValid, persisted: savedId !== null, httpStatus: generation ? 200 : diagnostics?.httpStatus ?? null,
        completionStatus, failureCategory: error ? error instanceof MetaMuseError ? error.code : schemaValid ? "WORDPRESS_ALT_PUBLICATION_FAILED" : "WORDPRESS_ALT_OUTPUT_INVALID" : null });
      if (generation && !receiptSaved) throw new ServiceUnavailableException("The funded generation has no settled receipt binding. Stop and reconcile; do not repeat inference.");
    };
    try {
      generation = mock ? { output: local, model: prepared.model, usage: { inputTokens: 0, outputTokens: 0 }, requestId: null }
        : await this.provider.generate(modelInput, undefined, { actor, scope: `wordpress-alt:${businessId}:${evidence.id}`, intentId: body.intentId ?? "" });
      if (generation.model !== prepared.model) throw new BadGatewayException("The proposal model did not match the prepared request.");
      let output;
      try { output = validateAltOutput(generation.output, evidence); } catch { throw new BadGatewayException({ code: "WORDPRESS_ALT_OUTPUT_INVALID", message: "Muse returned unsupported alt text. No proposal or write was created." }); }
      schemaValid = true;
      const record = generationSchema.parse({ id: randomUUID(), kind: "generation", businessId, actor, siteUrl: evidence.siteUrl, createdAt: new Date().toISOString(), evidenceId: evidence.id, inputHash,
        requestHash: prepared.requestHash, isMock: mock, provider: mock ? "mock-fixture" : "meta", model: generation.model, output, usage: generation.usage, requestId: generation.requestId,
        ...(evidence.purposeDependencyHash ? { executionFactsHash: executionFactsHash(evidence) } : {}),
        ...(generation.attemptId ? { attemptId: generation.attemptId } : {}) });
      const saved = this.store.publish(record); savedId = saved.id;
      await publishReceipt();
      return publicRecord(saved);
    } catch (error) {
      if (!receiptAttempted) await publishReceipt(error);
      throw error;
    }
  }
  async propose(businessId: string, actor: string, generationId: string, text: string) {
    const generation = generationSchema.parse(this.store.read(businessId, actor, generationId));
    let evidence = await this.evidence(businessId, actor, generation.evidenceId, false);
    if (generation.output.status !== "proposed") throw unavailable("Insufficient evidence cannot produce an executable proposal.");
    try { validateAltOutput(generation.output, evidence); validateHumanAltText(text, evidence); } catch { throw unavailable("Edited text must remain grounded in the verified image description/purpose."); }
    const checked = await this.current(evidence); evidence = checked.effectiveEvidence ?? evidence;
    if (evidence.purposeDependencyHash && generation.executionFactsHash !== executionFactsHash(evidence)) throw unavailable("Factual input changed since generation. Prepare a new exact model request; owner purpose is not renewed.");
    const proposal = await this.wordpress.propose(businessId, actor, { resource: "media", resourceId: evidence.target.mediaId, changes: { altText: text } });
    if (proposal.before.altText !== evidence.target.currentAlt || proposal.modified !== evidence.target.modified) throw unavailable("Media changed while preparing the proposal. The unapproved proposal must not be used.");
    const revision = revisionSchema.parse({ id: proposal.id, kind: "proposal", businessId, actor, siteUrl: evidence.siteUrl, createdAt: proposal.createdAt,
      evidenceId: evidence.id, generationId, proposalHash: proposal.hash, target: evidence.target, originalAlt: proposal.before.altText, proposedAlt: text, restorationOf: null,
      ...(evidence.purposeDependencyHash ? { executionFactsHash: executionFactsHash(evidence) } : {}),
      ...(text !== generation.output.altText ? { textOrigin: "human-edited" as const } : {}) });
    this.store.publish(revision);
    return { ...publicRecord(proposal), capability: ALT_CAPABILITY, field: "alt_text", generation: publicRecord(generation), restorationOf: null,
      ...(text !== generation.output.altText ? { textOrigin: "human-edited" as const } : {}) };
  }
  async generation(businessId: string, actor: string, id: string) {
    const generation = generationSchema.parse(this.store.read(businessId, actor, id));
    const evidence = await this.evidence(businessId, actor, generation.evidenceId, false);
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
    return { ...publicRecord(proposal), capability: ALT_CAPABILITY, field: "alt_text", restorationOf: revision.restorationOf,
      ...(revision.textOrigin ? { textOrigin: revision.textOrigin } : {}) };
  }
  async apply(businessId: string, actor: string, id: string, hash: string) {
    const { revision, proposal } = await this.revision(businessId, actor, id);
    if (hash !== proposal.hash) throw unavailable("Approve the exact current proposal hash.");
    if (!proposal.outcome) {
      if (!revision.restorationOf) {
        const evidence = await this.evidence(businessId, actor, revision.evidenceId, false);
        const checked = await this.current(evidence, revision.target);
        if (revision.executionFactsHash && executionFactsHash(checked.effectiveEvidence ?? evidence) !== revision.executionFactsHash)
          throw unavailable("Execution facts changed after proposal approval. Review a new exact proposal; no approval is transferred.");
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
    const owner = altEvidenceSchema.parse(this.store.read(businessId, actor, revision.evidenceId));
    if (this.purposes?.hasBinding(owner)) await this.purposes.checkRestoration(owner, fresh.target);
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
    const owner = altEvidenceSchema.parse(this.store.read(businessId, actor, revision.evidenceId));
    if (this.purposes?.hasBinding(owner)) await this.purposes.checkRestoration(owner, fresh.target);
    if (fresh.target.sourceUrl !== revision.target.sourceUrl || fresh.target.pageUrl !== revision.target.pageUrl || fresh.target.currentAlt !== revision.proposedAlt || fresh.target.modified !== outcome.storedModified) throw unavailable("An intervening change prevents restoration. Reconcile; do not overwrite it.");
    const proposal = await this.wordpress.propose(businessId, actor, { resource: "media", resourceId: revision.target.mediaId, changes: { altText: revision.originalAlt } });
    if (proposal.before.altText !== revision.proposedAlt || proposal.modified !== outcome.storedModified) throw unavailable("Media changed during restoration preparation.");
    this.store.publish(revisionSchema.parse({ ...revision, id: proposal.id, createdAt: proposal.createdAt, proposalHash: proposal.hash, target: fresh.target,
      originalAlt: revision.proposedAlt, proposedAlt: revision.originalAlt, restorationOf: id }));
    return { ...publicRecord(proposal), capability: ALT_CAPABILITY, field: "alt_text", restorationOf: id };
  }
}
