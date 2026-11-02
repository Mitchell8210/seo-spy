import { schedulePlannerV2, type PlannerV2Input, type PlannerV2Task } from "../src/modules/smart-planner/planner-scheduler-v2.js";

const defaults: PlannerV2Input = { weekStart: "2026-11-02", dailyCapacityMinutes: 120, maxTasksPerDay: 3,
  horizonWeeks: 4, useWeekends: false, timeZone: "UTC", now: new Date("2026-11-01T00:00:00Z") };
const task = (id: string, patch: Partial<PlannerV2Task> = {}): PlannerV2Task => ({ id, priority: "Medium", category: "Content", status: "Needs Action", ...patch });
const run = (tasks: PlannerV2Task[], patch: Partial<PlannerV2Input> = {}) => schedulePlannerV2(tasks, { ...defaults, ...patch });
const make = (count: number, patch: Partial<PlannerV2Task> = {}) => Array.from({ length: count }, (_, index) => task(`task-${String(index).padStart(3, "0")}`, patch));

describe("Duration-aware deterministic multiweek Auto Plan v2", () => {
  it("rolls twelve one-hour tasks into week two without exceeding daily capacity", () => {
    const tasks = make(12);
    const result = run(tasks);
    expect(result.policyVersion).toBe("planner-balanced-v2");
    expect(result.range).toEqual({ start: "2026-11-02", end: "2026-11-30" });
    expect(result.remaining).toEqual([]);
    const dates = Object.values(result.assignments).map(item => item.day);
    expect(dates.filter(day => day < "2026-11-09")).toHaveLength(10);
    expect(dates.filter(day => day >= "2026-11-09")).toHaveLength(2);
    for (const day of new Set(dates)) expect(dates.filter(item => item === day).length).toBeLessThanOrEqual(2);
  });

  it("uses the horizon as a bound and leaves small backlogs in the earliest week", () => {
    const result = run(make(5));
    expect(new Set(Object.values(result.assignments).map(item => item.day)).size).toBe(5);
    expect(Object.values(result.assignments).every(item => item.day < "2026-11-09")).toBe(true);
  });

  it("preserves every existing assignment and completed task without mutating inputs", () => {
    const tasks = [task("fixed", { schedule: { day: "2026-11-03", hour: 11, minute: 30 }, estimatedDurationMinutes: 90 }),
      task("done-scheduled", { status: "Done", schedule: { day: "2026-11-02", hour: 9 }, estimatedDurationMinutes: 120 }),
      task("done-unplanned", { status: "Done" }), task("outside-horizon", { schedule: { day: "2027-01-04", hour: 10 } }),
      task("new", { priority: "Urgent" })];
    const original = structuredClone(tasks), input = structuredClone(defaults);
    const result = schedulePlannerV2(tasks, input);
    expect(Object.keys(result.assignments)).toEqual(["new"]);
    expect(result.assignments.new).toEqual({ day: "2026-11-04", hour: 9, minute: 0 });
    expect(tasks).toEqual(original); expect(input).toEqual(defaults);
  });

  it("reserves the complete 90-minute interval and allows a half-hour task at its exact end", () => {
    const result = run([task("fixed", { schedule: { day: "2026-11-02", hour: 9 }, estimatedDurationMinutes: 90 }), task("new", { priority: "Urgent", estimatedDurationMinutes: 30 })]);
    expect(result.assignments.new).toEqual({ day: "2026-11-02", hour: 10, minute: 30 });
  });

  it("allows the final half-hour before 17:00 without extending the working window", () => {
    const result = run([
      task("morning", { schedule: { day: "2026-11-02", hour: 9 }, estimatedDurationMinutes: 240 }),
      task("afternoon", { schedule: { day: "2026-11-02", hour: 13 }, estimatedDurationMinutes: 120 }),
      task("late", { schedule: { day: "2026-11-02", hour: 15 }, estimatedDurationMinutes: 90 }),
      task("new", { priority: "Urgent", estimatedDurationMinutes: 30 }),
    ], { dailyCapacityMinutes: 480, maxTasksPerDay: 4 });
    expect(result.assignments.new).toEqual({ day: "2026-11-02", hour: 16, minute: 30 });
  });

  it("reports oversized tasks but continues planning feasible smaller tasks", () => {
    const result = run([task("too-long", { priority: "Urgent", estimatedDurationMinutes: 180 }), task("fits", { estimatedDurationMinutes: 30 })]);
    expect(result.remaining).toEqual([{ taskId: "too-long", reason: "duration_exceeds_daily_capacity" }]);
    expect(result.assignments.fits).toEqual({ day: "2026-11-02", hour: 9, minute: 0 });
  });

  it("honors the task-count limit even when minutes remain", () => {
    const result = run(make(6, { estimatedDurationMinutes: 30 }), { maxTasksPerDay: 1 });
    expect(Object.values(result.assignments).filter(item => item.day < "2026-11-09")).toHaveLength(5);
    expect(result.assignments["task-005"].day).toBe("2026-11-09");
  });

  it("leaves horizon overflow unscheduled and uses enabled weekends only", () => {
    const tasks = make(7);
    const weekdays = run(tasks, { horizonWeeks: 1, maxTasksPerDay: 1 });
    expect(Object.keys(weekdays.assignments)).toHaveLength(5);
    expect(weekdays.remaining).toEqual([
      { taskId: "task-005", reason: "horizon_capacity_exhausted" }, { taskId: "task-006", reason: "horizon_capacity_exhausted" },
    ]);
    const weekends = run(tasks, { horizonWeeks: 1, maxTasksPerDay: 1, useWeekends: true });
    expect(Object.values(weekends.assignments).map(item => item.day)).toContain("2026-11-07");
    expect(Object.values(weekends.assignments).map(item => item.day)).toContain("2026-11-08");
    expect(weekends.remaining).toEqual([]);
  });

  it("retains manual overlaps, sums their estimates and reports overloaded days", () => {
    const tasks = [task("manual-a", { schedule: { day: "2026-11-02", hour: 9 }, estimatedDurationMinutes: 90 }),
      task("manual-b", { schedule: { day: "2026-11-02", hour: 9 }, estimatedDurationMinutes: 90 }), task("new", { priority: "Urgent", estimatedDurationMinutes: 30 })];
    const before = structuredClone(tasks), result = run(tasks);
    expect(result.overloadedDays).toEqual(["2026-11-02"]);
    expect(result.assignments.new.day).toBe("2026-11-03"); expect(tasks).toEqual(before);
  });

  it("reports a fragmented working window separately from exhausted workload capacity", () => {
    const occupied = Array.from({ length: 5 }, (_, day) => Array.from({ length: 8 }, (_, hour) => task(`fixed-${day}-${hour}`, {
      schedule: { day: `2026-11-0${day + 2}`, hour: hour + 9 }, estimatedDurationMinutes: 30,
    }))).flat();
    const result = run([...occupied, task("long", { estimatedDurationMinutes: 60 })], { dailyCapacityMinutes: 480, maxTasksPerDay: 16, horizonWeeks: 1 });
    expect(result.remaining).toEqual([{ taskId: "long", reason: "no_contiguous_slot" }]);
  });

  it("uses urgent-first chronology, balanced flexible work and Monday Admin preference", () => {
    const result = run([task("flexible"), task("admin", { category: "Admin" }), task("urgent", { priority: "Urgent" }), task("low", { priority: "Low" })]);
    expect(result.assignments.urgent).toEqual({ day: "2026-11-02", hour: 9, minute: 0 });
    expect(result.assignments.admin).toEqual({ day: "2026-11-02", hour: 10, minute: 0 });
    expect(result.assignments.flexible.day).toBe("2026-11-03");
    expect(result.assignments.low.day).toBe("2026-11-04");
  });

  it("uses exact task IDs for assignments with deterministic legacy-sort-key ties", () => {
    const tasks = [task("report-b", { sortKey: "website:same" }), task("report-a", { sortKey: "website:same" })];
    const result = run(tasks);
    expect(Object.keys(result.assignments)).toEqual(["report-a", "report-b"]);
    expect(result.assignments["report-a"]).not.toEqual(result.assignments["report-b"]);
    expect(run([...tasks].reverse())).toEqual(result);
    expect(Object.keys(run([task("__proto__")]).assignments)).toEqual(["__proto__"]);
  });

  it.each([
    ["2026-11-02T09:30:00.000Z", 9, 30], ["2026-11-02T09:30:00.001Z", 10, 0], ["2026-11-02T09:15:00Z", 9, 30],
  ])("never assigns an elapsed start for current-day time %s", (now, hour, minute) => {
    expect(run([task("new", { priority: "Urgent", estimatedDurationMinutes: 30 })], { now: new Date(now) }).assignments.new)
      .toEqual({ day: "2026-11-02", hour, minute });
  });

  it("skips a finished workday and starts from the current local date rather than the server date", () => {
    const now = new Date("2026-11-02T17:15:00Z"), tasks = [task("new", { priority: "Urgent" })];
    expect(run(tasks, { now }).assignments.new.day).toBe("2026-11-03");
    expect(run(tasks, { now, timeZone: "America/Los_Angeles" }).assignments.new).toEqual({ day: "2026-11-02", hour: 9, minute: 30 });
    const partial = run(tasks, { now: new Date("2026-11-04T12:15:00Z") });
    expect(partial.range.start).toBe("2026-11-04");
    expect(partial.assignments.new).toEqual({ day: "2026-11-04", hour: 12, minute: 30 });
  });

  it.each([
    ["2026-03-09", "2026-03-09T16:00:00Z"], ["2026-11-02", "2026-11-02T17:00:00Z"],
  ])("keeps civil working hours through DST changes for %s", (weekStart, now) => {
    const result = run([task("new", { priority: "Urgent" })], { weekStart, now: new Date(now), timeZone: "America/Los_Angeles" });
    expect(result.assignments.new).toEqual({ day: weekStart, hour: 9, minute: 0 });
  });

  it("spans month/year boundaries with a bounded exclusive range end", () => {
    const result = run(make(12), { weekStart: "2026-12-28", now: new Date("2026-12-27T00:00:00Z"), horizonWeeks: 2 });
    expect(result.range).toEqual({ start: "2026-12-28", end: "2027-01-11" });
    expect(Object.values(result.assignments).some(item => item.day === "2027-01-04")).toBe(true);
  });

  it.each([
    { weekStart: "2026-11-03" }, { weekStart: "2026-02-30" }, { dailyCapacityMinutes: 15 }, { dailyCapacityMinutes: 121 },
    { dailyCapacityMinutes: 510 }, { maxTasksPerDay: 0 }, { maxTasksPerDay: 17 }, { horizonWeeks: 0 }, { horizonWeeks: 13 },
    { timeZone: "Not/AZone" }, { now: new Date("invalid") }, { now: new Date("2026-12-01T00:00:00Z") },
  ])("rejects invalid preferences or past horizons: %p", patch => { expect(() => run([], patch)).toThrow(Error); });

  it("rejects invalid durations, duplicate IDs and intervals outside the working window", () => {
    for (const estimate of [0, 45, 150, 300, NaN]) expect(() => run([task("invalid", { estimatedDurationMinutes: estimate })])).toThrow();
    expect(() => run([task("a"), task("a")])).toThrow();
    expect(() => run([task("late", { schedule: { day: "2026-11-02", hour: 16, minute: 30 } })])).toThrow();
    expect(() => run([task("early", { schedule: { day: "2026-11-02", hour: 8 } })])).toThrow();
  });
});
