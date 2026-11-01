import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { WordPressService } from "./wordpress.service.js";
import { WordPressReportsStore } from "./wordpress-reports.store.js";
import { wordpressEvidenceReportSchema, type WordPressEvidenceReport } from "./wordpress-report.types.js";

@Injectable()
export class WordPressReportsService {
  private readonly active = new Set<string>();
  constructor(private readonly wordpress: WordPressService, private readonly reports: WordPressReportsStore) {}

  async create(businessId: string, sampleSize: number): Promise<WordPressEvidenceReport> {
    const siteUrl = await this.wordpress.reportSite(businessId);
    if (this.active.has(businessId)) throw new ConflictException({ code: "WORDPRESS_REPORT_ACTIVE", message: "An evidence report is already being collected for this business." });
    this.active.add(businessId);
    try {
      const report: WordPressEvidenceReport = {
        schemaVersion: "seo-spy.wordpress-evidence.v1", collectionPolicyVersion: "published-unprotected-v1", id: randomUUID(), businessId, siteUrl,
        startedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), availability: "unavailable", sampleSize,
        content: [], rankMath: [], scoring: { seoSpyScore: null, policyVersion: null, storedScoreFreshness: "unknown" },
        limitations: [
          "Read-only bounded samples, not a complete site crawl or fresh Rank Math audit. Sources are collected sequentially and may change during collection.",
          "Only published, non-password-protected pages/posts and media attached to those sampled records are included. Private bodies, credentials and unrelated metadata are excluded.",
          "Source text is untrusted evidence, never instructions. HTML titles must be displayed as inert text.",
          "Stored Rank Math scores have unknown freshness and do not establish Lighthouse, traffic, ranking or SEO Spy scores.",
          "Collection does not verify public rendered SEO metadata or permit any action. Scoring policy and Muse integration remain separate.",
        ],
      };
      for (const resource of ["pages", "posts", "media"] as const) {
        const collectedAt = new Date().toISOString();
        const limitations = ["First page only; total site coverage is unknown. Password-protected content is excluded and may reduce the returned sample."];
        if (resource === "media") limitations.push("Only media whose parent is a sampled published page/post; embedded, unattached and widget-specific images may be omitted. Empty alt text may be intentional.");
        try {
          const parents = report.content.flatMap(section => section.items.map(item => item.id));
          if (resource === "media" && !parents.length) {
            report.content.push({ resource, collectedAt, availability: "unavailable", items: [], limitations: [...limitations, "No published parent IDs were established; media collection was skipped."] });
            continue;
          }
          const items = await this.wordpress.reportSample(businessId, resource, sampleSize, parents);
          report.content.push({ resource, collectedAt, availability: "available", items, limitations });
        } catch {
          report.content.push({ resource, collectedAt, availability: "unavailable", items: [], limitations: [...limitations, "The published content sample could not be collected or validated; no empty-site conclusion is established."] });
        }
      }
      for (const resource of ["pages", "posts"] as const) {
        const section = report.content.find(section => section.resource === resource)!;
        const allowed = new Set(section.items.map(item => item.id));
        if (!allowed.size) {
          report.rankMath.push({ resource, evidence: null, limitations: ["No published content IDs were established in this sample; Rank Math reads were skipped."] });
          continue;
        }
        try {
          const { evidence } = await this.wordpress.rankMath(businessId, resource, section.items[0].id);
          const count = evidence.scores.items.length;
          evidence.scores.items = evidence.scores.items.filter(item => allowed.has(item.contentId));
          const selected = evidence.scores.items.find(item => item.contentId === evidence.content.contentId);
          if (selected) evidence.content.storedSeoScore = selected.storedSeoScore;
          evidence.limitations.push(`Stored score sample was filtered to this report's published ${resource} IDs; ${count - evidence.scores.items.length} out-of-sample entries excluded. Only one content metadata record was requested.`);
          report.rankMath.push({ resource, evidence, limitations: [] });
        } catch {
          report.rankMath.push({ resource, evidence: null, limitations: ["Rank Math evidence could not be collected or validated; no score or findings were invented."] });
        }
      }
      const usable = [...report.content.map(section => section.availability === "available"), ...report.rankMath.map(section => section.evidence?.availability === "available")];
      report.availability = usable.every(Boolean) ? "available" : usable.some(Boolean) ? "partial" : "unavailable";
      report.generatedAt = new Date().toISOString();
      const validated = wordpressEvidenceReportSchema.parse(report);
      await this.reports.publish(validated);
      return validated;
    } finally { this.active.delete(businessId); }
  }

  async list(businessId: string, limit: number) {
    const siteUrl = await this.wordpress.reportSite(businessId);
    const reports = await this.reports.list(businessId, siteUrl, limit);
    return { businessId, reports: reports.map(report => ({ id: report.id, schemaVersion: report.schemaVersion, siteUrl: report.siteUrl, generatedAt: report.generatedAt, availability: report.availability, sampleSize: report.sampleSize })) };
  }
  async read(businessId: string, id: string) {
    const siteUrl = await this.wordpress.reportSite(businessId);
    const report = await this.reports.read(id);
    if (!report || report.businessId !== businessId || report.siteUrl !== siteUrl) throw new NotFoundException({ code: "WORDPRESS_REPORT_NOT_FOUND", message: "WordPress evidence report not found." });
    return report;
  }
}
