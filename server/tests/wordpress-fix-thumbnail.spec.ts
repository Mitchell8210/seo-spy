import "reflect-metadata";
import { WordPressFixService } from "../src/modules/wordpress/wordpress-fix.service.js";
import { fixDigest } from "../src/modules/wordpress/wordpress-fix.store.js";
import type { FileReportStore } from "../src/reports/file-report.store.js";
import type { AltEvidence } from "../src/modules/wordpress/wordpress-fix.types.js";

describe("saved WordPress fix thumbnail binding (no providers)", () => {
  const sourceUrl = "https://example.com/uploads/image.png", variant = "https://example.com/uploads/image-300x300.png";
  function fixture(renderedUrls = [variant], sourceUrls = [sourceUrl, variant]) {
    const target = { mediaId: 5658, pageResource: "pages", pageId: 5652, pageUrl: "https://example.com/page/", sourceUrl, currentAlt: "", modified: "2026-11-02T00:00:00" };
    const binding = { version: "wordpress-page-media-v1", businessId: "demo-guzman", siteUrl: "https://example.com", target, sourceUrls, mediaParentId: 5652,
      pageModified: "2026-11-02T00:00:00", metadataCollectedAt: "2026-11-02T00:00:00Z", publicCollectedAt: "2026-11-02T00:00:00Z", publicHtmlHash: "a".repeat(64), renderedUrls };
    const report = { reportId: "report", business: { id: "demo-guzman" }, audit: { businessId: "demo-guzman" },
      results: { evidence: [{ id: "evidence", auditId: "report", observed: { wordpressMediaBinding: JSON.stringify(binding) } }] } };
    const owner = { businessId: "demo-guzman", siteUrl: "https://example.com", target, source: { reportId: "report", evidenceId: "evidence", reportHash: fixDigest(report) } } as AltEvidence;
    const reports = { read: async () => report } as unknown as FileReportStore;
    const service = new WordPressFixService(null as never, reports, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
    return { service, owner };
  }
  it("uses the exact saved rendered size rather than inventing a thumbnail URL", async () => {
    const { service, owner } = fixture(); expect(await service["savedThumbnail"](owner)).toBe(variant);
  });
  it("rejects unrelated assets and foreign hosts", async () => {
    for (const [rendered, catalog] of [[["https://other.test/image.png"], [sourceUrl, "https://other.test/image.png"]], [[variant], [sourceUrl]]]) {
      const { service, owner } = fixture(rendered, catalog); expect(await service["savedThumbnail"](owner)).toBe(sourceUrl);
    }
  });
  it("keeps historical receipts usable when optional source binding is missing or changed", async () => {
    const { service, owner } = fixture(); owner.source.reportHash = "b".repeat(64);
    expect(await service["savedThumbnail"](owner)).toBe(sourceUrl);
  });
});
