import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { BUSINESS_REPOSITORY, type BusinessRepository } from "../../persistence/repositories.js";
import { WordPressClient, WordPressRequestError, type WordPressConnection } from "../../integrations/wordpress/wordpress.client.js";
import { collectRankMathEvidence, runRankMathAudit, rankMathOutcomeStatus } from "../../integrations/wordpress/rankmath.js";
import { WordPressActionsStore } from "./wordpress-actions.store.js";
import type { CreateWordPressProposalDto } from "./wordpress.dto.js";

const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = (value: object) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const proposalSchema = z.object({ version: z.literal("wordpress-proposal-v1"), id: z.string().uuid(), hash: z.string().length(64), businessId: z.string(), actor: z.string(), siteUrl: z.string(), resource: z.enum(["pages", "posts", "media"]), resourceId: z.number().int().positive(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(), modified: z.string(), before: z.record(z.string(), z.string()), changes: z.record(z.string(), z.string()) });
type Proposal = z.infer<typeof proposalSchema>;
const fieldNames: Record<string, string> = { title: "title", content: "content", excerpt: "excerpt", slug: "slug", altText: "alt_text", caption: "caption", description: "description" };
const resourceFields: Record<string, string[]> = { pages: ["title", "content", "excerpt", "slug"], posts: ["title", "content", "excerpt", "slug"], media: ["title", "altText", "caption", "description", "slug"] };

@Injectable()
export class WordPressService {
  constructor(private readonly config: ConfigService, private readonly client: WordPressClient, private readonly store: WordPressActionsStore,
    @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository) {}

  async reportSite(businessId: string): Promise<string> {
    const business = await this.businesses.findById(businessId);
    if (!business) throw new NotFoundException({ code: "BUSINESS_NOT_FOUND", message: "Business not found." });
    if (businessId !== this.config.get<string>("WORDPRESS_BUSINESS_ID")) throw new ForbiddenException({ code: "WORDPRESS_BUSINESS_MISMATCH", message: "No WordPress installation is configured for this business." });
    const siteUrl = this.config.get<string>("WORDPRESS_SITE_URL") ?? "";
    if (!siteUrl) throw new ServiceUnavailableException("WordPress connection is not configured.");
    try {
      if (new URL(siteUrl).hostname.replace(/^www\./, "") !== new URL(business.website).hostname.replace(/^www\./, "")) throw new Error();
    } catch { throw new ForbiddenException({ code: "WORDPRESS_SITE_MISMATCH", message: "The configured installation does not match the registered business website." }); }
    return siteUrl;
  }
  private async connection(businessId: string): Promise<WordPressConnection> {
    const siteUrl = await this.reportSite(businessId);
    const username = this.config.get<string>("WORDPRESS_USERNAME") ?? "";
    const applicationPassword = this.config.get<string>("WORDPRESS_APPLICATION_PASSWORD") ?? "";
    if (!username || !applicationPassword) throw new ServiceUnavailableException("WordPress connection is not configured.");
    return { businessId, siteUrl, username, applicationPassword };
  }
  async reportSample(businessId: string, resource: "pages" | "posts" | "media", limit: number, parents: number[] = []) {
    const connection = await this.connection(businessId);
    const query = new URLSearchParams({ context: "view", per_page: String(limit), page: "1", status: resource === "media" ? "inherit" : "publish", _fields: "id,status,post,title,link,modified_gmt,alt_text,content.protected" });
    if (resource === "media") {
      if (!parents.length) return [];
      query.set("parent", parents.join(","));
    }
    const data = await this.client.request(connection, "GET", `/wp-json/wp/v2/${resource}?${query}`);
    if (!Array.isArray(data) || data.length > limit) throw new BadGatewayException("WordPress returned an invalid evidence sample.");
    return data.filter(entry => {
      if (resource === "media") return true;
      const protectedContent = object(object(entry).content).protected;
      if (typeof protectedContent !== "boolean") throw new BadGatewayException("WordPress did not establish content visibility.");
      return !protectedContent;
    }).map(entry => {
      const item = object(entry);
      if (!Number.isSafeInteger(item.id) || Number(item.id) < 1 || (resource === "media" ? item.status !== "inherit" || !parents.includes(Number(item.post)) : item.status !== "publish")) throw new BadGatewayException("WordPress returned an unexpected evidence target.");
      const text = (value: unknown) => typeof value === "string" ? value.slice(0, 4000) : null;
      return { id: Number(item.id), title: text(object(item.title).rendered), link: text(item.link), modifiedAt: text(item.modified_gmt), altText: resource === "media" ? text(item.alt_text) : null };
    });
  }
  private resource(resource: string) { if (!Object.hasOwn(resourceFields, resource)) throw new BadRequestException({ code: "WORDPRESS_RESOURCE_UNSUPPORTED", message: "Only pages, posts and media are supported." }); return resource; }
  private async raw(connection: WordPressConnection, resource: string, id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new BadRequestException("A positive content ID is required.");
    const data = object(await this.client.request(connection, "GET", `/wp-json/wp/v2/${this.resource(resource)}/${id}?context=edit`));
    if (data.id !== id) throw new BadGatewayException("WordPress returned an unexpected content record.");
    return data;
  }
  private clean(data: Record<string, unknown>) {
    return Object.fromEntries(["id", "type", "slug", "status", "link", "modified_gmt", "title", "content", "excerpt", "alt_text", "caption", "description"].filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  }
  async info(businessId: string) {
    const connection = await this.connection(businessId);
    const user = object(await this.client.request(connection, "GET", "/wp-json/wp/v2/users/me?context=edit"));
    if (!Number.isInteger(user.id)) throw new BadGatewayException("WordPress authentication could not be verified.");
    const capabilities = object(user.capabilities);
    return { businessId, siteUrl: connection.siteUrl, authenticated: true, userId: user.id, roles: user.roles,
      capabilities: Object.fromEntries(["edit_pages", "edit_posts", "edit_published_pages", "edit_published_posts", "upload_files", "manage_options"].map(key => [key, capabilities[key] === true])),
      writesEnabled: this.enabled(), mode: "local_operator", scope: "Existing content updates only; no plugin, user, theme, deletion or generic HTTP actions." };
  }
  async list(businessId: string, resource: string, page: number, perPage: number) {
    const connection = await this.connection(businessId);
    const data = await this.client.request(connection, "GET", `/wp-json/wp/v2/${this.resource(resource)}?context=edit&page=${page}&per_page=${perPage}&_fields=id,type,slug,status,link,modified_gmt,title`);
    if (!Array.isArray(data)) throw new BadGatewayException("WordPress returned an unexpected content list.");
    return { businessId, resource, page, perPage, items: data.map(item => this.clean(object(item))), collectedAt: new Date().toISOString() };
  }
  async content(businessId: string, resource: string, id: number) { return { businessId, resource, collectedAt: new Date().toISOString(), content: this.clean(await this.raw(await this.connection(businessId), resource, id)) }; }
  async rankMath(businessId: string, resource: "pages" | "posts", id?: number) {
    const connection = await this.connection(businessId);
    return { businessId, evidence: await collectRankMathEvidence((path, method = "GET") => this.client.request(connection, method, `/wp-json${path}`), { contentType: resource, contentId: id, limit: 20 }) };
  }
  private value(data: Record<string, unknown>, key: string): string {
    const value = data[fieldNames[key]];
    if (typeof value === "string") return value;
    const raw = object(value).raw;
    if (typeof raw === "string") return raw;
    throw new ConflictException({ code: "WORDPRESS_BEFORE_VALUE_UNAVAILABLE", message: "WordPress did not expose the original field value for a safe update." });
  }
  async propose(businessId: string, actor: string, body: CreateWordPressProposalDto) {
    const connection = await this.connection(businessId);
    const resource = this.resource(body.resource);
    const changes = Object.fromEntries(Object.entries(body.changes).filter(([, value]) => value !== undefined));
    if (!Object.keys(changes).length || Object.entries(changes).some(([key, value]) => !resourceFields[resource].includes(key) || typeof value !== "string")) throw new BadRequestException({ code: "WORDPRESS_INVALID_PATCH", message: "The patch must contain supported fields with string values." });
    const current = await this.raw(connection, resource, body.resourceId);
    const meta = object(current.meta);
    if (Object.hasOwn(changes, "content") && (meta._elementor_edit_mode === "builder" || Boolean(meta._elementor_data))) throw new ConflictException({ code: "WORDPRESS_BUILDER_CONTENT", message: "Elementor content requires a dedicated structured-content adapter; generic body replacement is disabled." });
    if (typeof current.modified_gmt !== "string" || !current.modified_gmt) throw new ConflictException("A WordPress modification timestamp is required.");
    const before = Object.fromEntries(Object.keys(changes).map(key => [key, this.value(current, key)]));
    if (Object.entries(changes).every(([key, value]) => before[key] === value)) throw new BadRequestException({ code: "WORDPRESS_NO_CHANGE", message: "The proposed fields already match the current content." });
    const base = { version: "wordpress-proposal-v1" as const, id: randomUUID(), businessId, actor, siteUrl: connection.siteUrl, resource: body.resource, resourceId: body.resourceId,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), modified: current.modified_gmt, before, changes: changes as Record<string, string> };
    const proposal: Proposal = { ...base, hash: digest(base) };
    if (!await this.store.create(proposal.id, "proposal", proposal)) throw new ConflictException("The proposal could not be reserved.");
    return proposal;
  }
  private async proposal(businessId: string, actor: string, id: string) {
    const stored = await this.store.read(id, "proposal");
    if (!stored) throw new NotFoundException({ code: "WORDPRESS_PROPOSAL_NOT_FOUND", message: "Proposal not found." });
    const parsed = proposalSchema.safeParse(stored);
    if (!parsed.success) throw new ServiceUnavailableException("The proposal record is invalid.");
    const proposal = parsed.data;
    if (!Object.keys(proposal.changes).length || Object.keys(proposal.changes).some(key => !resourceFields[proposal.resource].includes(key) || typeof proposal.before[key] !== "string")) throw new ServiceUnavailableException("The stored patch is invalid.");
    if (proposal.businessId !== businessId || proposal.actor !== actor) throw new ForbiddenException({ code: "WORDPRESS_PROPOSAL_OWNER", message: "This proposal belongs to another operator or business." });
    // Preserve original insertion order when verifying the persisted hash.
    const { hash, ...original } = stored as Proposal;
    if (hash !== digest(original)) throw new ServiceUnavailableException("The proposal integrity check failed.");
    return proposal;
  }
  async getProposal(businessId: string, actor: string, id: string) { const proposal = await this.proposal(businessId, actor, id); return { ...proposal, outcome: await this.store.read(id, "outcome"), executionStarted: Boolean(await this.store.read(id, "started")) }; }
  async verificationTarget(businessId: string, actor: string, proposalId: string, pageResource: "pages" | "posts", pageId: number) {
    const connection = await this.connection(businessId);
    const proposal = await this.proposal(businessId, actor, proposalId);
    const outcome = object(await this.store.read(proposalId, "outcome"));
    if (proposal.siteUrl !== connection.siteUrl || outcome.status !== "applied" || proposal.resource !== "media" || Object.keys(proposal.changes).length !== 1 || typeof proposal.changes.altText !== "string")
      throw new ConflictException({ code: "WORDPRESS_VERIFICATION_UNSUPPORTED", message: "Public verification requires an applied media alt-text-only proposal on the currently bound installation." });
    if (!["pages", "posts"].includes(pageResource)) throw new BadRequestException("Only published pages or posts can be verified.");
    const page = await this.raw(connection, pageResource, pageId);
    const media = await this.raw(connection, "media", proposal.resourceId);
    if (page.status !== "publish" || typeof page.link !== "string" || typeof media.source_url !== "string") throw new ConflictException("Published page and image source information are required for verification.");
    try {
      const url = new URL(page.link);
      const site = new URL(connection.siteUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname.replace(/^www\./, "") !== site.hostname.replace(/^www\./, "")) throw new Error();
    } catch { throw new ConflictException("The public page does not belong to the registered HTTPS website."); }
    return { siteUrl: connection.siteUrl, pageUrl: page.link, sourceUrl: media.source_url, mediaId: proposal.resourceId, expectedAlt: proposal.changes.altText, storedFieldMatches: typeof media.alt_text === "string" && media.alt_text === proposal.changes.altText };
  }
  private enabled() { return this.config.get("WORDPRESS_WRITES_ENABLED") === true || this.config.get("WORDPRESS_WRITES_ENABLED") === "true"; }
  private requireWrites() { if (!this.enabled()) throw new ForbiddenException({ code: "WORDPRESS_WRITES_DISABLED", message: "WordPress writes and audit triggers are disabled by configuration." }); }
  async apply(businessId: string, actor: string, id: string, hash: string) {
    const connection = await this.connection(businessId);
    const proposal = await this.proposal(businessId, actor, id);
    if (proposal.hash !== hash) throw new ConflictException({ code: "WORDPRESS_APPROVAL_MISMATCH", message: "Approval must match the exact reviewed proposal hash." });
    const completed = await this.store.read(id, "outcome"); if (completed) return completed;
    this.requireWrites();
    if (Date.parse(proposal.expiresAt) <= Date.now() || proposal.siteUrl !== connection.siteUrl) throw new ConflictException({ code: "WORDPRESS_PROPOSAL_STALE", message: "The proposal expired or the installation changed; create and review a new proposal." });
    if (!await this.store.create(id, "started", { businessId, actor, proposalHash: hash, startedAt: new Date().toISOString() })) throw new ConflictException({ code: "WORDPRESS_EXECUTION_RESERVED", message: "Execution was already reserved. Inspect or reconcile its outcome; do not resend the write." });
    let outcome: object;
    let dispatched = false;
    let uncertain = false;
    const release = await this.store.reserveTarget(digest({ siteUrl: connection.siteUrl, resource: proposal.resource, id: proposal.resourceId }));
    if (!release) {
      await this.store.create(id, "outcome", { id, businessId, status: "failed", code: "TARGET_RESERVED_NOT_DISPATCHED", completedAt: new Date().toISOString() });
      throw new ConflictException({ code: "WORDPRESS_TARGET_RESERVED", message: "The target is reserved by another execution. Inspect existing work before creating a new proposal." });
    }
    let releaseReady = false;
    const publish = async (value: object) => {
      if (!await this.store.create(id, "outcome", value)) throw new ServiceUnavailableException("The execution outcome could not be published.");
      releaseReady = !uncertain;
      return value;
    };
    try {
      const current = await this.raw(connection, proposal.resource, proposal.resourceId);
      if (current.modified_gmt !== proposal.modified || Object.keys(proposal.changes).some(key => this.value(current, key) !== proposal.before[key])) throw new ConflictException({ code: "WORDPRESS_TARGET_CHANGED", message: "The target changed after review; create a new proposal." });
      const patch = Object.fromEntries(Object.entries(proposal.changes).map(([key, value]) => [fieldNames[key], value]));
      dispatched = true;
      const updated = object(await this.client.request(connection, "POST", `/wp-json/wp/v2/${proposal.resource}/${proposal.resourceId}`, patch));
      if (updated.id !== proposal.resourceId || typeof updated.code === "string" || Object.hasOwn(updated, "error")) throw new WordPressRequestError("WORDPRESS_INVALID_WRITE_RESPONSE", "WordPress did not return a matching updated resource; reconcile before retrying.");
      let verification = "inconclusive";
      try { const fresh = await this.raw(connection, proposal.resource, proposal.resourceId); verification = Object.entries(proposal.changes).every(([key, value]) => this.value(fresh, key) === value) ? "verified_stored_fields" : "mismatch"; } catch { /* Applied is distinct from verification. */ }
      outcome = { id, businessId, status: "applied", verification, limitation: "Stored fields verified only; public rendering and SEO impact require separate collection.", completedAt: new Date().toISOString() };
      return await publish(outcome);
    } catch (error) {
      if (!dispatched) { await publish({ id, businessId, status: "failed", code: "PREFLIGHT_FAILED", completedAt: new Date().toISOString() }); throw error; }
      // WordPress hooks may mutate earlier fields before returning even a 4xx error.
      // Any failure after dispatch is uncertain until fresh reconciliation.
      uncertain = true;
      outcome = { id, businessId, status: "outcome_unknown", verification: "inconclusive", message: "The write outcome must be inspected before any new action. This execution will not automatically retry.", completedAt: new Date().toISOString() };
      return await publish(outcome);
    } finally { if (releaseReady) await release(); }
  }
  async audit(businessId: string, actor: string, requestId: string) {
    const connection = await this.connection(businessId); this.requireWrites();
    const prior = await this.store.read(requestId, "started");
    if (prior) {
      const owner = object(prior);
      if (owner.actor !== actor || owner.businessId !== businessId || owner.kind !== "rankmath_audit") throw new ConflictException("The request ID is already bound to another operation.");
      const outcome = await this.store.read(requestId, "outcome");
      if (outcome) return rankMathOutcomeStatus(outcome);
      throw new ConflictException("The audit was already reserved; its outcome is pending or unknown.");
    }
    if (!await this.store.create(requestId, "started", { businessId, actor, kind: "rankmath_audit", startedAt: new Date().toISOString() })) throw new ConflictException("The audit was already reserved.");
    let outcome: object;
    try {
      const result = await runRankMathAudit((path, method = "GET", observer) => this.client.request(connection, method, `/wp-json${path}`, undefined, observer));
      outcome = { id: requestId, businessId, status: result.status, result, completedAt: new Date().toISOString() };
    }
    catch { outcome = { id: requestId, businessId, status: "unknown", message: "Rank Math audit request did not complete. Do not repeat it without checking the existing outcome.", completedAt: new Date().toISOString() }; }
    if (!await this.store.create(requestId, "outcome", outcome)) throw new ServiceUnavailableException("The audit outcome could not be published.");
    return outcome;
  }
  async auditResult(businessId: string, actor: string, requestId: string) {
    const started = object(await this.store.read(requestId, "started"));
    if (!started.kind) throw new NotFoundException({ code: "WORDPRESS_AUDIT_NOT_FOUND", message: "Audit request not found." });
    if (started.kind !== "rankmath_audit" || started.actor !== actor || started.businessId !== businessId) throw new ForbiddenException({ code: "WORDPRESS_AUDIT_OWNER", message: "The audit belongs to another operator or business." });
    const outcome = rankMathOutcomeStatus(await this.store.read(requestId, "outcome"));
    return { id: requestId, businessId, status: object(outcome).status ?? "unknown", outcome, limitation: "A reserved or legacy request without diagnostic proof is unknown; it must not be automatically retried." };
  }
}
