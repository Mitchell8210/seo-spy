import { z } from "zod";
import type { ScoreAssessmentInput } from "./scoring.types.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.object({ provider: z.enum(["website", "facebook"]), reportId: z.string().min(1), reportHash: hash, observationHash: hash,
  businessId: z.string().min(1), schemaVersion: z.literal("seo-spy.audit-report.v1"), mode: z.literal("live"), asset: z.string().min(1), collectedAt: z.string().datetime({ offset: true }),
  selectionReason: z.string().min(1), evidenceIds: z.array(z.string().min(1)).min(1).max(20000) }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reuseSchema = z.object({ version: z.literal("unchanged-source-observations-v1"), originalSources: z.array(source).length(2),
  currentSources: z.array(source.pick({ provider: true, reportId: true, reportHash: true, observationHash: true })).length(2),
  reviews: z.array(z.object({ observedAt: z.string().datetime({ offset: true }), validFrom: date, validUntil: date.optional(), timeZone: z.string().nullable() }).strict()).max(4),
}).strict();

/** Validates provenance and original review clocks both during calculation and current saved reads. */
export function sourceReviewReuseReasons(input: ScoreAssessmentInput, at = input.cutoff): string[] {
  const facts = input.consistency?.facts;
  const parsed = reuseSchema.safeParse(facts?.reviewReuse);
  if (!parsed.success || !facts?.sourceAttestation) return ["UNCONFIRMED_SOURCE_REUSE"];
  const proof = parsed.data;
  const now = Date.parse(at), age = 7 * 86400000;
  const fresh = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now && now - Date.parse(value) <= age;
  const reasons: string[] = [];
  if (!fresh(facts.confirmedAt) || proof.originalSources.some(item => !fresh(item.collectedAt)) || proof.reviews.some(item => !fresh(item.observedAt))) reasons.push("SOURCE_REVIEW_EXPIRED");
  for (const provider of ["website", "facebook"] as const) {
    const original = proof.originalSources.filter(item => item.provider === provider);
    const current = proof.currentSources.filter(item => item.provider === provider);
    const selected = input.sources.filter(item => item.provider === provider);
    const expectedId = facts.sourceAttestation[provider === "website" ? "websiteReportId" : "facebookReportId"];
    if (original.length !== 1 || current.length !== 1 || selected.length !== 1 || original[0]!.reportId !== expectedId
      || original[0]!.businessId !== input.businessId || original[0]!.asset !== selected[0]!.asset
      || current[0]!.reportId !== selected[0]!.reportId || current[0]!.reportHash !== selected[0]!.reportHash
      || original[0]!.observationHash !== current[0]!.observationHash) reasons.push("SOURCE_REVIEW_CHANGED_OR_UNAVAILABLE");
  }
  for (const review of proof.reviews) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: review.timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      const part = (name: string) => parts.find(item => item.type === name)!.value;
      const today = `${part("year")}-${part("month")}-${part("day")}`;
      if (review.validFrom > today || review.validUntil && review.validUntil < today) reasons.push("SOURCE_REVIEW_EXPIRED");
    } catch { reasons.push("SOURCE_REVIEW_CHANGED_OR_UNAVAILABLE"); }
  }
  return [...new Set(reasons)];
}
