import { readFileSync } from "node:fs";
import ts from "typescript";
import { autoSchedule, isWeekend, validPlannerDay, type SchedulableTask } from "../src/modules/smart-planner/planner-scheduler.js";

// Execute the existing client policy as the reference, rather than another copied algorithm.
const compiled = ts.transpileModule(readFileSync(new URL("../../client/src/services/smartPlanner.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const clientExports: { autoSchedule?: (tasks: SchedulableTask[], monday: Date, weekends: boolean) => unknown } = {};
new Function("exports", "require", compiled)(clientExports, () => ({ opportunityTitle: (title: string) => title }));
const task = (id: string, index: number): SchedulableTask => ({ id, priority: (["Urgent", "Medium", "Low"] as const)[index % 3],
  category: ["Admin", "Content", "Social", "Search", "Review"][index % 5], status: index % 11 === 0 ? "Done" : "Needs Action" });

describe("Smart Planner deterministic scheduling parity", () => {
  it.each([false, true])("matches the current frontend policy across capacity, mixed priorities and existing overlaps, weekends %s", weekends => {
    for (const size of [0, 1, 7, 40, 56, 100]) {
      const tasks = Array.from({ length: size }, (_, index) => task(`source:${String(index).padStart(3, "0")}`, index));
      for (const index of [1, 5, 9]) if (tasks[index]) tasks[index].schedule = { day: "2026-11-03", hour: 11 };
      if (tasks[8]) tasks[8].schedule = { day: "2026-11-10", hour: 9 };
      const before = structuredClone(tasks);
      expect(autoSchedule(tasks, "2026-11-02", weekends)).toEqual(clientExports.autoSchedule!(tasks, new Date(2026, 10, 2, 12), weekends));
      expect(tasks).toEqual(before);
    }
  });
  it("handles calendar dates across year and DST boundaries without interpreting dates as UTC instants in the browser", () => {
    for (const day of ["2026-12-28", "2026-03-09", "2026-11-02"]) {
      const tasks = Array.from({ length: 55 }, (_, index) => task(String(index), index));
      const [year, month, date] = day.split("-").map(Number);
      expect(autoSchedule(tasks, day, true)).toEqual(clientExports.autoSchedule!(tasks, new Date(year, month - 1, date, 12), true));
    }
  });
  it("rejects impossible dates and identifies weekends", () => {
    expect(validPlannerDay("2026-02-30")).toBe(false);
    expect(validPlannerDay("2028-02-29")).toBe(true);
    expect(validPlannerDay("2026-2-03")).toBe(false);
    expect(isWeekend("2026-11-07")).toBe(true);
    expect(isWeekend("2026-11-02")).toBe(false);
  });
  it("assigns distinct slots to historical tasks sharing a legacy sort key without overwriting a schedule", () => {
    const tasks: SchedulableTask[] = [
      { id: "uuid-report-a", sortKey: "website:finding", priority: "Medium", category: "Content", status: "Needs Action" },
      { id: "uuid-report-b", sortKey: "website:finding", priority: "Medium", category: "Content", status: "Needs Action" },
    ];
    const planned = autoSchedule(tasks, "2026-11-02", false);
    expect(Object.keys(planned)).toEqual(["uuid-report-a", "uuid-report-b"]);
    expect(planned["uuid-report-a"]).not.toEqual(planned["uuid-report-b"]);
    expect(autoSchedule(tasks, "2026-11-02", false)).toEqual(planned);
  });
});
