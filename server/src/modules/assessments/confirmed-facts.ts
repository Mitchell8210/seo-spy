import { z } from "zod";
import { sourceHoursReviewSchema, weeklyHoursSchema } from "./consistency-evidence.js";

export const profileCriterionIds = ["business-name", "description", "website-link", "contact-route", "category"] as const;
export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const website = z.string().url().max(2048).refine(value => { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; });
export const confirmedFactsInputSchema = z.object({
  confirmed: z.literal(true),
  publishingTarget: z.number().int().positive().max(1000).nullable(),
  preferred: z.object({
    name: z.string().trim().min(1).max(256), aliases: z.array(z.string().trim().min(1).max(256)).max(10),
    country: z.enum(["US", "CA", "international"]), phones: z.array(z.string().regex(/^\+[1-9]\d{6,14}$/)).max(10), phoneApplicable: z.boolean().default(true),
    websiteUrls: z.array(website).min(1).max(10),
    timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
    hours: weeklyHoursSchema.nullable(), hoursApplicable: z.boolean(),
  }).strict().refine(value => !value.hoursApplicable || value.hours !== null, { message: "Confirmed hours are required when hours apply." })
    .refine(value => !value.phoneApplicable || value.phones.length > 0, { message: "An approved phone is required when phone comparison applies." }),
  profileAbsences: z.array(z.object({ criterion: z.enum(profileCriterionIds), reportId: z.string().uuid(), evidenceIds: z.array(z.string().min(1).max(160)).min(1).max(8), visibleAbsenceConfirmed: z.literal(true), notes: z.string().trim().min(10).max(500) }).strict()).max(5),
  sourceReviews: z.array(sourceHoursReviewSchema).max(4).optional(),
}).strict();
export const confirmedFactsSchema = z.object({
  schemaVersion: z.literal("seo-spy.confirmed-scoring-facts.v1"), id: z.string().uuid(), businessId: z.string().min(1).max(128),
  createdAt: z.string().datetime(), confirmedBy: z.string().regex(/^[a-f0-9]{64}$/), values: confirmedFactsInputSchema,
}).strict();
export type ConfirmedScoringFacts = z.infer<typeof confirmedFactsSchema>;
export const sourceAgreementInputSchema = z.object({
  confirmed: z.literal(true), comparisonMode: z.literal("source-agreement"), country: z.enum(["US", "CA", "international"]),
  confirmedPhone: z.string().regex(/^\+[1-9]\d{6,14}$/), websiteReportId: z.string().uuid(), facebookReportId: z.string().uuid(),
  sourceReviews: z.array(sourceHoursReviewSchema).max(4), notes: z.string().trim().min(10).max(1000),
}).strict();
export const sourceAgreementFactsSchema = z.object({
  schemaVersion: z.literal("seo-spy.confirmed-scoring-facts.v2"), id: z.string().uuid(), businessId: z.string().min(1).max(128),
  createdAt: z.string().datetime(), confirmedBy: z.string().regex(/^[a-f0-9]{64}$/), values: sourceAgreementInputSchema,
}).strict();
export const allConfirmedFactsSchema = z.union([confirmedFactsSchema, sourceAgreementFactsSchema]);
export type SourceAgreementFacts = z.infer<typeof sourceAgreementFactsSchema>;
export type AnyConfirmedScoringFacts = z.infer<typeof allConfirmedFactsSchema>;
