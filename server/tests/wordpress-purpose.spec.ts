import { randomUUID } from "node:crypto";
import { purposeDependencies, purposeDependencyHash, deterministicPurposeBindingId, validatePurposeBinding, purposeBindingSchema, executionStateSchema, PURPOSE_POLICY_VERSION } from "../src/modules/wordpress/wordpress-purpose.types.js";
import { fixDigest } from "../src/modules/wordpress/wordpress-fix.store.js";
import type { AltEvidence } from "../src/modules/wordpress/wordpress-fix.types.js";
import type { WordPressService } from "../src/modules/wordpress/wordpress.service.js";

const reviewedAt = "2026-11-02T10:00:00.000Z", actor = "a".repeat(64);
const site = "https://example.com", sourceUrl = `${site}/full.png`, variant = `${site}/crop.webp`, pageUrl = `${site}/bookkeeping/`;
function fixture() {
  const business = { id: "offline-business", name: "Guzman Tax Accounting", website: site };
  const pageContext = { id: 9, resource: "pages" as const, url: pageUrl, title: "Bookkeeping", textExcerpt: "Ayuda con cartas del IRS.", collectedAt: reviewedAt };
  const evidence: AltEvidence = { id: "671a83d5-1032-411d-85b0-a2a813b0aeec", kind: "evidence", businessId: business.id, actor, siteUrl: site,
    createdAt: reviewedAt, expiresAt: "2026-11-02T10:15:00.000Z", capability: "wordpress.media.alt_text.update",
    source: { reportId: "f9a23a35-80a0-45ea-8a9e-7cce4f4b6756", findingId: "image-review", evidenceId: "36e85d9e-e870-4a8e-aa5f-55199c4b2b74", reportHash: "b".repeat(64) },
    target: { mediaId: 7, pageId: 9, pageResource: "pages", sourceUrl, pageUrl, currentAlt: "", modified: "2026-11-02T00:00:00" },
    purpose: "informative", verifiedDescription: "Gráfico sobre ayuda con cartas del IRS para negocios.", descriptionProvenance: "operator-confirmed-text; no model visual inspection",
    proposalContext: { version: "wordpress-alt-context-v2", language: "es", requiredTerms: ["ayuda", "cartas", "IRS"], business: structuredClone(business), page: structuredClone(pageContext) } };
  const image = { sourceUrl, sha256: "c".repeat(64), bytes: 1000 };
  const fresh: Awaited<ReturnType<WordPressService["altTarget"]>> = { target: structuredClone(evidence.target), sourceUrls: [sourceUrl, variant].sort(), mediaParentId: 9,
    pageModified: "2026-11-02T00:00:00", pageTitle: "Bookkeeping", metadataCollectedAt: reviewedAt,
    pageHtml: `<!-- wp:image {"id":7,"sizeSlug":"large","linkDestination":"none"} --><figure id="irs-promotion" class="wp-block-image"><h2>IRS letters</h2><img class="wp-image-7" src="${variant}" alt=""><figcaption>IRS assistance</figcaption></figure>` };
  return { evidence, fresh, image, pageContext, business };
}
const dependencies = (value: ReturnType<typeof fixture>) => purposeDependencies(value.evidence, value.fresh, value.image, value.pageContext, value.business);
function binding(value = fixture()) {
  const deps = dependencies(value);
  return { id: deterministicPurposeBindingId(value.evidence.id), kind: "purpose-binding" as const, businessId: value.evidence.businessId, actor, siteUrl: site,
    createdAt: "2026-11-02T10:05:00.000Z", policyVersion: PURPOSE_POLICY_VERSION, evidenceId: value.evidence.id,
    originalReviewHash: fixDigest(value.evidence), originalConfirmedAt: value.evidence.createdAt, originalConfirmedBy: value.evidence.actor,
    dependencyHash: purposeDependencyHash(deps), dependencies: deps, originalImageHash: value.image.sha256, hashProvenance: "Explicit operator-attested original image SHA-256 baseline; no renewal inferred." };
}

describe("pure durable WordPress purpose dependencies", () => {
  it("binds exact owner, image pixels, page content and placement without operational clocks", () => {
    const value = fixture(), deps = dependencies(value);
    expect(deps).toMatchObject({ policyVersion: PURPOSE_POLICY_VERSION, evidenceId: value.evidence.id, originalReviewHash: fixDigest(value.evidence),
      business: { id: value.business.id, name: value.business.name }, media: { id: 7, parentId: 9, sourceUrl, sourceUrls: expect.arrayContaining([variant]) },
      image: value.image, page: { id: 9, resource: "pages", url: pageUrl, title: "Bookkeeping" },
      review: { purpose: "informative", language: "es", requiredTerms: ["ayuda", "cartas", "IRS"] } });
    expect(deps.placements[0]).toMatchObject({ imageIndex: 0, caption: "IRS assistance", heading: "IRS letters", block: { id: 7, sizeSlug: "large", linkDestination: "none" } });
    expect(deps.placements[0].ancestors).toContainEqual(expect.objectContaining({ tag: "figure", attributes: expect.objectContaining({ id: "irs-promotion" }) }));
    const serialized = JSON.stringify(deps);
    for (const field of ['"currentAlt"', '"modified"', '"pageModified"', '"collectedAt"', '"checkedAt"', '"expiresAt"']) expect(serialized).not.toContain(field);
  });

  it("keeps the immutable review and dependency hash unchanged when alt and modification clocks change", () => {
    const value = fixture(), original = structuredClone(value.evidence), first = purposeDependencyHash(dependencies(value));
    value.fresh.target.currentAlt = "New independently approved alt"; value.fresh.target.modified = "2026-11-03T00:00:00";
    value.fresh.pageModified = "2026-11-03T00:00:00"; value.fresh.metadataCollectedAt = "2026-11-03T10:00:00.000Z";
    value.pageContext.collectedAt = "2026-11-03T10:00:00.000Z";
    value.fresh.pageHtml = value.fresh.pageHtml.replace('alt=""', 'alt="New independently approved alt"');
    expect(purposeDependencyHash(dependencies(value))).toBe(first); expect(value.evidence).toEqual(original);
  });

  it("canonicalizes authoritative source ordering and duplicates without filename inference", () => {
    const value = fixture(), first = purposeDependencyHash(dependencies(value));
    value.fresh.sourceUrls = [variant, sourceUrl, variant];
    expect(purposeDependencyHash(dependencies(value))).toBe(first);
    value.fresh.pageHtml = value.fresh.pageHtml.replace(variant, `${site}/full-1024x1024.png`);
    expect(() => dependencies(value)).toThrow();
  });

  it.each(["pixels", "bytes", "source-catalog", "description", "purpose", "terms", "image-id", "ancestor-id", "caption", "heading", "position", "link"])("invalidates material %s changes", kind => {
    const value = fixture(), first = purposeDependencyHash(dependencies(value));
    if (kind === "pixels") value.image.sha256 = "d".repeat(64);
    if (kind === "bytes") value.image.bytes++;
    if (kind === "source-catalog") value.fresh.sourceUrls.push(`${site}/registered-small.webp`);
    if (kind === "description") value.evidence.verifiedDescription += " Atención en español.";
    if (kind === "purpose") value.evidence.purpose = "decorative";
    if (kind === "terms") value.evidence.proposalContext!.requiredTerms = ["IRS"];
    if (kind === "image-id") value.fresh.pageHtml = value.fresh.pageHtml.replace('class="wp-image-7"', 'id="new-image-placement" class="wp-image-7"');
    if (kind === "ancestor-id") value.fresh.pageHtml = value.fresh.pageHtml.replace("irs-promotion", "other-placement");
    if (kind === "caption") value.fresh.pageHtml = value.fresh.pageHtml.replace("IRS assistance", "Tax promotion");
    if (kind === "heading") value.fresh.pageHtml = value.fresh.pageHtml.replace("IRS letters", "Business support");
    if (kind === "position") value.fresh.pageHtml = '<img src="/unrelated.png" alt="">' + value.fresh.pageHtml;
    if (kind === "link") value.fresh.pageHtml = value.fresh.pageHtml.replace('<img class="wp-image-7"', '<a href="/consultation/" title="Consultation"><img class="wp-image-7"').replace('alt="">', 'alt=""></a>');
    expect(purposeDependencyHash(dependencies(value))).not.toBe(first);
  });

  it.each(["business-id", "site", "business-site", "business-name", "media-id", "media-source", "page-id", "page-url", "parent", "context-id", "context-page", "context-title", "context-text", "foreign-catalog", "wrong-pixels-resource", "block-id"])("rejects mismatched %s identity/context", kind => {
    const value = fixture();
    if (kind === "business-id") value.business.id = "another-business";
    if (kind === "site") value.evidence.siteUrl = "https://unrelated.example";
    if (kind === "business-site") value.business.website = "https://unrelated.example";
    if (kind === "business-name") value.business.name = "Another business";
    if (kind === "media-id") value.fresh.target.mediaId = 8;
    if (kind === "media-source") value.fresh.target.sourceUrl = `${site}/another.png`;
    if (kind === "page-id") value.fresh.target.pageId = 10;
    if (kind === "page-url") value.fresh.target.pageUrl = `${site}/unrelated/`;
    if (kind === "parent") value.fresh.mediaParentId = 10;
    if (kind === "context-id") value.pageContext.id = 10;
    if (kind === "context-page") value.pageContext.url = `${site}/unrelated/`;
    if (kind === "context-title") value.pageContext.title = "Changed title";
    if (kind === "context-text") value.pageContext.textExcerpt = "A different purpose and audience.";
    if (kind === "foreign-catalog") value.fresh.sourceUrls.push("https://unrelated.example/crop.webp");
    if (kind === "wrong-pixels-resource") value.image.sourceUrl = variant;
    if (kind === "block-id") value.fresh.pageHtml = value.fresh.pageHtml.replace('"id":7', '"id":8');
    expect(() => dependencies(value)).toThrow();
  });

  it("rejects conflicting repeated image roles while retaining equivalent placements", () => {
    const value = fixture();
    value.fresh.pageHtml = `<main><img class="wp-image-7" src="${variant}" alt=""><img class="wp-image-7" src="${variant}" alt="different"></main>`;
    expect(dependencies(value).placements).toHaveLength(2);
    value.fresh.pageHtml = value.fresh.pageHtml.replace('<img class="wp-image-7"', '<img aria-hidden="true" class="wp-image-7"');
    expect(() => dependencies(value)).toThrow();
  });

  it("requires an actual bounded image hash baseline and positive byte count", () => {
    for (const image of [{ ...fixture().image, sha256: "filename-only" }, { ...fixture().image, bytes: 0 }, { ...fixture().image, bytes: 2 * 1024 * 1024 + 1 }]) {
      const value = fixture(); value.image = image; expect(() => dependencies(value)).toThrow();
    }
  });

  it("includes paired public placement and context fingerprints in the dependency hash", () => {
    const deps = dependencies(fixture());
    const publicDeps = { ...structuredClone(deps), publicPlacements: structuredClone(deps.placements), publicContextHash: "d".repeat(64) };
    const before = purposeDependencyHash(publicDeps);
    expect(before).not.toBe(purposeDependencyHash(deps));
    publicDeps.publicPlacements[0].image["data-id"] = "changed-public-placement";
    expect(purposeDependencyHash(publicDeps)).not.toBe(before);
    publicDeps.publicPlacements = structuredClone(deps.placements); publicDeps.publicContextHash = "e".repeat(64);
    expect(purposeDependencyHash(publicDeps)).not.toBe(before);
    expect(() => purposeDependencyHash({ ...deps, publicContextHash: "d".repeat(64) })).toThrow();
    expect(() => purposeDependencyHash({ ...deps, publicPlacements: deps.placements })).toThrow();
  });

  it("includes rendered responsive image pixels in addition to the original image hash", () => {
    const deps = dependencies(fixture());
    const withVariants = { ...deps, renderedImages: [deps.image, { sourceUrl: variant, sha256: "d".repeat(64), bytes: 500 }] };
    const before = purposeDependencyHash(withVariants);
    withVariants.renderedImages[1].sha256 = "e".repeat(64);
    expect(purposeDependencyHash(withVariants)).not.toBe(before);
    expect(withVariants.image.sha256).toBe(deps.image.sha256);
  });
});

describe("immutable purpose bindings and separate execution state schemas", () => {
  it("uses a deterministic UUIDv4 and preserves original owner actor/date/hash", () => {
    const value = fixture(), record = binding(value);
    expect(record.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(deterministicPurposeBindingId(value.evidence.id)).toBe(record.id);
    expect(deterministicPurposeBindingId(randomUUID())).not.toBe(record.id);
    expect(validatePurposeBinding(record, value.evidence)).toEqual(record);
    expect(record.originalConfirmedAt).toBe(reviewedAt); expect(record.originalConfirmedBy).toBe(actor);
  });

  it.each(["id", "review-hash", "actor", "confirmed-by", "confirmed-at", "evidence", "image-hash", "dependency-hash", "purpose", "business", "page-context"])("rejects forged binding %s", kind => {
    const value = fixture(), record = binding(value);
    if (kind === "id") record.id = randomUUID();
    if (kind === "review-hash") record.originalReviewHash = "d".repeat(64);
    if (kind === "actor") record.actor = "d".repeat(64);
    if (kind === "confirmed-by") record.originalConfirmedBy = "d".repeat(64);
    if (kind === "confirmed-at") record.originalConfirmedAt = "2026-11-02T10:01:00.000Z";
    if (kind === "evidence") record.evidenceId = randomUUID();
    if (kind === "image-hash") record.originalImageHash = "d".repeat(64);
    if (kind === "dependency-hash") record.dependencyHash = "d".repeat(64);
    if (kind === "purpose") { record.dependencies.review.purpose = "decorative"; record.dependencyHash = purposeDependencyHash(record.dependencies); }
    if (kind === "business") { record.dependencies.business.name = "Another business"; record.dependencyHash = purposeDependencyHash(record.dependencies); }
    if (kind === "page-context") { record.dependencies.page.textExcerpt = "An unrelated purpose"; record.dependencyHash = purposeDependencyHash(record.dependencies); }
    expect(() => validatePurposeBinding(record, value.evidence)).toThrow();
  });

  it("rejects extra fields and unbounded execution lifetimes", () => {
    const value = fixture(), record = binding(value);
    expect(() => purposeBindingSchema.parse({ ...record, allowWrite: true })).toThrow();
    const execution = { id: randomUUID(), kind: "execution-state", businessId: value.evidence.businessId, actor, siteUrl: site,
      createdAt: reviewedAt, expiresAt: "2026-11-02T10:15:00.000Z", evidenceId: value.evidence.id, purposeBindingId: record.id, dependencyHash: record.dependencyHash,
      target: value.fresh.target, source: value.evidence.source, proposalContext: value.evidence.proposalContext };
    expect(executionStateSchema.parse(execution)).toEqual(execution);
    expect(() => executionStateSchema.parse({ ...execution, expiresAt: "2026-11-02T10:16:00.000Z" })).toThrow();
    expect(() => executionStateSchema.parse({ ...execution, expiresAt: reviewedAt })).toThrow();
    expect(() => executionStateSchema.parse({ ...execution, paidIntentApproved: true })).toThrow();
  });
});
