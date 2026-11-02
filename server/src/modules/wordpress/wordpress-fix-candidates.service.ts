import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";
import type { AuditReportRecord } from "../../reports/report.types.js";
import { WordPressService } from "./wordpress.service.js";
import { WordPressFixService } from "./wordpress-fix.service.js";
import { WordPressFixStore } from "./wordpress-fix.store.js";
import { ALT_CAPABILITY, altEvidenceSchema, fixHash } from "./wordpress-fix.types.js";
import { pageMediaBindingSchema } from "./wordpress-page-evidence.service.js";

/** Saved, exact page/media opportunities only. Viewing this list never collects, confirms purpose or dispatches a provider. */
@Injectable()
export class WordPressFixCandidatesService {
  constructor(private readonly database: AppDatabase, private readonly wordpress: WordPressService,
    private readonly fixes: WordPressFixService, private readonly store: WordPressFixStore, private readonly config: ConfigService) {}

  async list(businessId: string, actor: string) {
    const siteUrl = await this.wordpress.reportSite(businessId);
    const workflows = (await this.fixes.workflows(businessId, actor)).items;
    // Applied or uncertain executions must never become a new action merely because an older report still has empty alt.
    const executed = new Set(workflows.filter(row => row.workflow.proposal?.executionStarted || row.workflow.proposal?.outcome)
      .map(row => row.workflow.proposal!.resourceId));
    const owners = this.store.list(businessId, actor).filter(row => row.kind === "evidence").map(row => altEvidenceSchema.parse(row));
    const realMode = [false, "false"].includes(this.config.get("MOCK_AI") ?? true) && this.config.get("AI_MODE") === "poc"
      && [true, "true"].includes(this.config.get("AI_ENABLED") ?? false);
    const seen = new Set<string>(), items = [];
    for (const artifact of this.database.listArtifacts("audit-report", businessId, 100)) {
      const report = artifact.payload as AuditReportRecord;
      if (report.audit?.scope !== "wordpress-page" || report.audit.mode !== "live" || report.audit.businessId !== businessId
        || report.business?.id !== businessId || !report.results || report.reportId !== artifact.id) continue;
      for (const finding of report.results.findings) {
        if (finding.checkId !== "image-alt" || finding.source !== "website" || finding.status !== "needs_review") continue;
        for (const evidenceId of finding.evidenceIds) {
          const evidence = report.results.evidence.find(row => row.id === evidenceId && row.auditId === report.reportId && row.checkId === "image-alt" && row.mode === "live");
          if (!evidence?.observed.wordpressMediaBinding) continue;
          let raw: unknown; try { raw = JSON.parse(evidence.observed.wordpressMediaBinding); } catch { continue; }
          const parsed = pageMediaBindingSchema.safeParse(raw); if (!parsed.success) continue;
          const binding = parsed.data, target = binding.target, key = `${target.mediaId}:${target.pageResource}:${target.pageId}`;
          const fresh = [evidence.collectedAt, binding.metadataCollectedAt, binding.publicCollectedAt].every(value => {
            const age = Date.now() - Date.parse(value); return Number.isFinite(age) && age >= -60000 && age <= 7 * 86400000;
          });
          if (!fresh || evidence.collectedAt !== binding.publicCollectedAt || Math.abs(Date.parse(binding.metadataCollectedAt) - Date.parse(binding.publicCollectedAt)) > 120000
            || binding.businessId !== businessId || binding.siteUrl !== siteUrl || binding.mediaParentId !== target.pageId
            || target.currentAlt !== "" || evidence.sourceUrl !== target.pageUrl || executed.has(target.mediaId) || seen.has(key)
            || !binding.sourceUrls.includes(target.sourceUrl) || binding.renderedUrls.some(url => !binding.sourceUrls.includes(url))) continue;
          const sameSite = (value: string) => {
            try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port
              && url.hostname.replace(/^www\./, "") === new URL(siteUrl).hostname.replace(/^www\./, ""); } catch { return false; }
          };
          if (![target.sourceUrl, target.pageUrl, ...binding.sourceUrls].every(sameSite)) continue;
          seen.add(key);
          const owner = owners.find(row => row.siteUrl === siteUrl && row.source.reportId === report.reportId && row.source.findingId === finding.id
            && row.source.evidenceId === evidence.id && row.target.mediaId === target.mediaId && row.target.pageId === target.pageId);
          const purposeStatus = owner?.purpose === "informative" ? "informative" as const : owner?.purpose === "decorative" ? "decorative" as const : owner ? "unknown" as const : "unreviewed" as const;
          const capability = owner ? await this.fixes.capability(businessId, actor, report.reportId, finding.id) : {
            capability: ALT_CAPABILITY, fixable: false, reason: "Review image purpose before proposing an alternative. Empty alt may be intentional.",
            evidence: null, writesEnabled: [true, "true"].includes(this.config.get("WORDPRESS_WRITES_ENABLED") ?? false), savedGeneration: null, workflow: null,
            limitations: ["Exact saved page/media association is established; image purpose and essential meaning still require explicit human review."] };
          // Decorative/redundant empty alternatives are already appropriate and are not fixes.
          if (purposeStatus === "decorative") continue;
          const issue = purposeStatus === "informative" ? "This informative image has empty alternative text in the saved evidence."
            : "This image has empty alternative text. Review whether it is informative, decorative or redundant with nearby text.";
          const sourceHash = fixHash.safeParse(evidence.observed.sourceImageSha256);
          const sourceImageCollectedAt = evidence.observed.sourceImageCollectedAt;
          const imageHash = sourceHash.success && Number.isFinite(Date.parse(sourceImageCollectedAt ?? "")) ? sourceHash.data : null;
          items.push({ businessId, reportId: report.reportId, findingId: finding.id, evidenceId: evidence.id, target,
            thumbnailUrl: binding.renderedUrls.find(url => url !== target.sourceUrl) ?? target.sourceUrl,
            pageTitle: typeof evidence.observed.pageTitle === "string" ? evidence.observed.pageTitle.slice(0, 300) : null,
            pageLanguage: evidence.observed.pageLanguage === "es" || evidence.observed.pageLanguage === "en" ? evidence.observed.pageLanguage : null,
            purposeStatus, requiresPurposeConfirmation: purposeStatus !== "informative" || !!owner && Date.parse(owner.expiresAt) <= Date.now()
              && !("purposeReusable" in capability && capability.purposeReusable), isMock: false, collectedAt: evidence.collectedAt, issue,
            imageHash, imageHashProvenance: imageHash ? `Exact original-source raster fingerprint recorded by immutable report ${report.reportId} at ${sourceImageCollectedAt}.` : null,
            capability: { ...capability, liveGenerationAllowed: realMode && capability.workflow?.generationApproval?.status === "approved" } });
        }
      }
    }
    return { businessId, items, modelCalls: 0, wordPressWrites: 0 };
  }
}
