import { createHash } from "node:crypto";
import { z } from "zod";

export const priorities = ["Urgent", "Medium", "Low"] as const;
export const categories = ["Admin", "Content", "Social", "Search", "Review"] as const;
export const statuses = ["Needs Action", "Done"] as const;
export const durationOptions = [30, 60, 90, 120, 180, 240] as const;
export const defaultPlanningPreferences = { dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: null as string | null };
export interface PlannerPlanningPreferences { dailyCapacityMinutes: number; maxTasksPerDay: number; horizonWeeks: number; timeZone: string | null }
export const planningOutcomeSchema = z.object({
  policyVersion: z.literal("planner-balanced-v2"), range: z.object({ start: z.string().refine(value => validDay(value)), end: z.string().refine(value => validDay(value)) }).strict().refine(value => value.end > value.start),
  scheduledCount: z.number().int().min(0).max(10000), remaining: z.array(z.object({ taskId: z.string().uuid(), reason: z.enum(["duration_exceeds_daily_capacity", "no_contiguous_slot", "horizon_capacity_exhausted"]) }).strict()).max(10000), overloadedDays: z.array(z.string().refine(value => validDay(value))).max(84),
}).strict();
export type PlannerPlanningOutcome = z.infer<typeof planningOutcomeSchema>;
export const validPlannerTimeZone = (value: string): boolean => {
  if (!value || value.length > 100 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); return true; } catch { return false; }
};
export const validDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export const weekend = (day: string): boolean => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
export const scheduleSchema = z.object({ day: z.string().refine(validDay), hour: z.number().int().min(9).max(16), minute: z.union([z.literal(0), z.literal(30)]).optional() }).strict();
export type PlannerSchedule = z.infer<typeof scheduleSchema>;
export const taskSchema = z.object({
  id: z.string().uuid(), taskKey: z.string().min(1).max(2048), orderKey: z.string().min(1).max(2048),
  title: z.string().min(1).max(2000), explanation: z.string().max(32000), guidance: z.string().max(32000),
  priority: z.enum(priorities), category: z.enum(categories), source: z.string().max(2000),
  mode: z.enum(["demo", "saved", "custom"]), status: z.enum(statuses),
  schedule: scheduleSchema.nullable(), destination: z.string().refine(value => value.startsWith("/") && !value.startsWith("//")).nullable(),
  notes: z.string().max(2000).nullable(), origin: z.record(z.string(), z.unknown()).nullable(),
  sourceChannel: z.enum(["website", "social", "consistency"]).nullable(), sourcePresent: z.boolean(),
  completedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  payloadVersion: z.literal(2).optional(), estimatedDurationMinutes: z.number().refine(value => (durationOptions as readonly number[]).includes(value)).optional(),
  durationEstimateSource: z.enum(["default", "legacy-default", "user"]).optional(),
  scheduledBy: z.enum(["manual", "auto", "legacy-unknown"]).nullable().optional(),
}).strict().superRefine((task, context) => {
  if ((task.status === "Done") !== (task.completedAt !== null)) context.addIssue({ code: "custom", message: "Completion timestamp mismatch" });
  if ((task.estimatedDurationMinutes === undefined) !== (task.durationEstimateSource === undefined) || task.payloadVersion === 2 && task.estimatedDurationMinutes === undefined) context.addIssue({ code: "custom", message: "Duration estimate provenance mismatch" });
  if (task.schedule && task.schedule.hour * 60 + (task.schedule.minute ?? 0) + (task.estimatedDurationMinutes ?? 60) > 17 * 60) context.addIssue({ code: "custom", message: "Task interval exceeds the visible working window" });
  const custom = task.mode === "custom";
  if (custom ? task.origin !== null || task.sourceChannel !== null || task.taskKey !== `custom:${task.id}`
    : task.origin === null || task.sourceChannel === null || task.origin.channel !== task.sourceChannel) context.addIssue({ code: "custom", message: "Task origin mismatch" });
});
export type PlannerRecordTask = z.infer<typeof taskSchema>;
export interface PlannerState extends PlannerPlanningPreferences { businessId: string; revision: number; useWeekends: boolean; createdAt: string | null; updatedAt: string | null; tasks: PlannerRecordTask[]; mutationResult?: PlannerPlanningOutcome }
export interface PlannerMutation { expectedRevision: number; mutationId: string }
export interface PlannerRepository {
  read(businessId: string): Promise<PlannerState>;
  mutate(businessId: string, mutation: PlannerMutation, requestHash: string, apply: (state: PlannerState) => void): Promise<PlannerState>;
}
/** Stable canonical JSON for exact origin identity and duplicate request detection. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
export const checksum = (value: string): string => createHash("sha256").update(value).digest("hex");
export function sourceTaskId(businessId: string, origin: unknown): string {
  const hash = createHash("sha1").update("seo-spy.smart-planner.origin.v1\0").update(canonical([businessId, origin])).digest("hex").split("");
  hash[12] = "5"; hash[16] = ((parseInt(hash[16], 16) & 3) | 8).toString(16);
  const id = hash.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}
