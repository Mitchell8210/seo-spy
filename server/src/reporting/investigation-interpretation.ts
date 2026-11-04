import { z } from "zod";
import { createHash } from "node:crypto";
import type { AuditReportRecord } from "../reports/report.types.js";

export const INTERPRETATION_VERSION = "investigation-interpretation-v1";
export const interpretationOutputSchema = z.object({
  summary: z.string().min(1).max(500),
  recommendations: z.array(z.object({ category: z.enum(["website", "social", "consistency"]), title: z.string().min(1).max(90),
    recommendation: z.string().min(1).max(420), rationale: z.string().min(1).max(240),
    evidence: z.array(z.number().int().nonnegative()).min(1).max(6), finding: z.number().int().nonnegative().nullable(),
    verification: z.string().min(1).max(200),
  }).strict()).max(4),
}).strict();
export const interpretationSchema = z.object({
  schemaVersion: z.literal(INTERPRETATION_VERSION), id: z.string().uuid(), businessId: z.string(), createdAt: z.string().datetime(),
  sources: z.array(z.object({ reportId: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/), provider: z.enum(["website", "facebook"]) }).strict()).min(1).max(2),
  status: z.enum(["pending", "completed", "failed"]), errorCode: z.string().max(100).nullable(),
  model: z.string(), attemptId: z.string().nullable(), summary: z.string().nullable(),
  recommendations: z.array(z.object({ id: z.string(), category: z.enum(["website", "social", "consistency"]),
    reportId: z.string().uuid(), findingId: z.string().nullable(), title: z.string(), recommendation: z.string(), rationale: z.string(), verification: z.string(),
    evidenceRefs: z.array(z.object({ reportId: z.string().uuid(), evidenceId: z.string() }).strict()).min(1).max(6),
  }).strict()).max(4),
}).strict();
export type InvestigationInterpretation = z.infer<typeof interpretationSchema>;
export interface InterpretationContext { actor: string; businessId: string; siteUrl: string }
export const interpretationHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function interpretationSources(reports: AuditReportRecord[]) {
  return reports.map(report => ({ reportId: report.auditId, hash: interpretationHash(report), provider: report.audit.scope === "facebook" ? "facebook" as const : "website" as const }))
    .sort((a, b) => a.reportId.localeCompare(b.reportId));
}
