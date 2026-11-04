import { isWeekend, validPlannerDay } from "./planner-scheduler.js";

export interface PlannerV2Schedule { day: string; hour: number; minute: 0 | 30 }
export interface PlannerV2Task {
  id: string;
  sortKey?: string;
  priority: "Urgent" | "Medium" | "Low";
  category: string;
  status: "Needs Action" | "Done";
  schedule?: { day: string; hour: number; minute?: 0 | 30 } | null;
  estimatedDurationMinutes?: number;
}
export interface PlannerV2Input {
  weekStart: string;
  dailyCapacityMinutes: number;
  maxTasksPerDay: number;
  horizonWeeks: number;
  useWeekends: boolean;
  timeZone: string;
  now: Date;
}
export type PlannerV2RemainingReason = "duration_exceeds_daily_capacity" | "no_contiguous_slot" | "horizon_capacity_exhausted";
export interface PlannerV2Result {
  policyVersion: "planner-balanced-v2";
  /** Civil dates. End is exclusive; start excludes any wholly past dates. */
  range: { start: string; end: string };
  assignments: Record<string, PlannerV2Schedule>;
  remaining: { taskId: string; reason: PlannerV2RemainingReason }[];
  overloadedDays: string[];
}
interface DayLoad {
  day: string;
  week: number;
  weekday: number;
  minutes: number;
  count: number;
  occupied: { start: number; end: number }[];
}
const durations = new Set([30, 60, 90, 120, 180, 240]);
const ranks = { Urgent: 0, Medium: 1, Low: 2 };
const invalid = (): never => { throw new Error("Invalid planner-balanced-v2 scheduling input."); };
const durationOf = (task: PlannerV2Task): number => task.estimatedDurationMinutes === undefined ? 60 : task.estimatedDurationMinutes;
const civilWeekday = (day: string): number => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  const result = date.toISOString().slice(0, 10);
  if (!validPlannerDay(result)) invalid();
  return result;
}
function localClock(now: Date, timeZone: string): { day: string; minute: number } {
  if (!now || typeof now.getTime !== "function" || !Number.isFinite(now.getTime()) || typeof timeZone !== "string" || !timeZone || timeZone.length > 128) invalid();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
    const day = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
    if (!validPlannerDay(day)) invalid();
    return { day, minute: Number(part("hour")) * 60 + Number(part("minute")) + Number(part("second")) / 60 + now.getUTCMilliseconds() / 60000 };
  } catch { return invalid(); }
}
function validate(tasks: PlannerV2Task[], input: PlannerV2Input): void {
  if (!validPlannerDay(input.weekStart) || civilWeekday(input.weekStart) !== 0
    || !Number.isInteger(input.dailyCapacityMinutes) || input.dailyCapacityMinutes < 30 || input.dailyCapacityMinutes > 480 || input.dailyCapacityMinutes % 30 !== 0
    || !Number.isInteger(input.maxTasksPerDay) || input.maxTasksPerDay < 1 || input.maxTasksPerDay > 16
    || !Number.isInteger(input.horizonWeeks) || input.horizonWeeks < 1 || input.horizonWeeks > 12 || typeof input.useWeekends !== "boolean") invalid();
  const ids = new Set<string>();
  for (const task of tasks) {
    if (typeof task.id !== "string" || !task.id || ids.has(task.id) || !Object.hasOwn(ranks, task.priority)
      || !["Needs Action", "Done"].includes(task.status) || !durations.has(durationOf(task))
      || typeof task.category !== "string" || task.sortKey !== undefined && typeof task.sortKey !== "string") invalid();
    ids.add(task.id);
    if (task.schedule) {
      const { day, hour, minute = 0 } = task.schedule;
      if (!validPlannerDay(day) || !Number.isInteger(hour) || hour < 9 || hour > 16 || ![0, 30].includes(minute)
        || hour * 60 + minute + durationOf(task) > 17 * 60) invalid();
    }
  }
}
function firstSlot(day: DayLoad, duration: number, clock: { day: string; minute: number }): number | undefined {
  for (let start = 9 * 60; start + duration <= 17 * 60; start += 30) {
    if (day.day === clock.day && start < clock.minute) continue;
    if (!day.occupied.some(interval => start < interval.end && start + duration > interval.start)) return start;
  }
  return undefined;
}

/** Pure bounded scheduling policy. No task, schedule, preference or supplied clock is mutated. */
export function schedulePlannerV2(tasks: PlannerV2Task[], input: PlannerV2Input): PlannerV2Result {
  validate(tasks, input);
  const clock = localClock(input.now, input.timeZone);
  const end = addDays(input.weekStart, input.horizonWeeks * 7);
  if (end <= clock.day) throw new Error("The planning horizon is wholly in the past.");
  const start = input.weekStart > clock.day ? input.weekStart : clock.day;
  const days: DayLoad[] = Array.from({ length: input.horizonWeeks * 7 }, (_, index) => {
    const day = addDays(input.weekStart, index);
    return { day, week: Math.floor(index / 7), weekday: index % 7, minutes: 0, count: 0, occupied: [] };
  }).filter(day => day.day >= start);
  const byDate = new Map(days.map(day => [day.day, day]));
  for (const task of tasks) {
    if (!task.schedule) continue;
    const day = byDate.get(task.schedule.day);
    if (!day) continue;
    const duration = durationOf(task), start = task.schedule.hour * 60 + (task.schedule.minute ?? 0);
    day.minutes += duration; day.count++;
    day.occupied.push({ start, end: start + duration });
  }
  const overloadedDays = days.filter(day => day.minutes > input.dailyCapacityMinutes || day.count > input.maxTasksPerDay).map(day => day.day);
  const eligibleDays = days.filter(day => input.useWeekends || !isWeekend(day.day));
  const assignments: Record<string, PlannerV2Schedule> = Object.create(null) as Record<string, PlannerV2Schedule>;
  const remaining: PlannerV2Result["remaining"] = [];
  const pending = tasks.filter(task => task.status === "Needs Action" && !task.schedule).sort((a, b) =>
    ranks[a.priority] - ranks[b.priority] || Number(b.category === "Admin") - Number(a.category === "Admin")
    || (a.sortKey ?? a.id).localeCompare(b.sortKey ?? b.id) || a.id.localeCompare(b.id));
  for (const task of pending) {
    const duration = durationOf(task);
    if (duration > input.dailyCapacityMinutes) { remaining.push({ taskId: task.id, reason: "duration_exceeds_daily_capacity" }); continue; }
    const capacity = eligibleDays.filter(day => day.count < input.maxTasksPerDay && day.minutes + duration <= input.dailyCapacityMinutes);
    const available = capacity.map(day => ({ day, minute: firstSlot(day, duration, clock) })).filter((slot): slot is { day: DayLoad; minute: number } => slot.minute !== undefined);
    if (!available.length) {
      remaining.push({ taskId: task.id, reason: capacity.length ? "no_contiguous_slot" : "horizon_capacity_exhausted" });
      continue;
    }
    available.sort((a, b) => {
      const week = a.day.week - b.day.week;
      if (week) return week;
      if (task.priority === "Urgent") return a.day.day.localeCompare(b.day.day) || a.minute - b.minute;
      const adminPreference = (day: DayLoad) => task.category === "Admin" && day.weekday === 0 && day.count < 2 ? -1 : 0;
      return adminPreference(a.day) - adminPreference(b.day) || a.day.minutes - b.day.minutes
        || a.day.day.localeCompare(b.day.day) || a.minute - b.minute;
    });
    const chosen = available[0];
    assignments[task.id] = { day: chosen.day.day, hour: Math.floor(chosen.minute / 60), minute: chosen.minute % 60 as 0 | 30 };
    chosen.day.minutes += duration; chosen.day.count++;
    chosen.day.occupied.push({ start: chosen.minute, end: chosen.minute + duration });
  }
  return { policyVersion: "planner-balanced-v2", range: { start, end }, assignments, remaining, overloadedDays };
}
