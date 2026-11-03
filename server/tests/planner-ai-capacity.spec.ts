import { fitAiProposalCapacity } from "../src/modules/smart-planner/planner-ai.capacity.js";
import { computeWorkloads, defaultAiSettings, makeAiSnapshot, offlineAiProposal, validateAiProposal, type AiPlanEntry, type AiSnapshot } from "../src/modules/smart-planner/planner-ai.domain.js";
import { compactPlannerMuseInput } from "../src/modules/smart-planner/planner-muse.compact.js";
import type { PlannerResponseDto } from "../src/modules/smart-planner/planner.dto.js";

const now = new Date("2026-11-02T08:00:00Z");
function fixture(count = 23) {
  const task = (i: number): PlannerResponseDto["tasks"][number] => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, taskKey: `fixture-${i}`, title: `Saved task ${i}`, explanation: "Saved finding", guidance: "Review saved guidance", category: "Search", priority: "Medium", source: "Custom task", mode: "custom", status: "Needs Action", schedule: null, notes: null, destination: null, origin: null, completedAt: null, estimatedDurationMinutes: 60, durationEstimateSource: "user", scheduledBy: null });
  const state: PlannerResponseDto = { businessId: "business-a", revision: 5, preferences: { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: "UTC" }, sources: [],
    tasks: [{ ...task(99), status: "Done", completedAt: now.toISOString(), schedule: { day: "2026-11-02", hour: 16 } }, ...Array.from({ length: count }, (_, i) => task(i + 1))] };
  const snapshot = makeAiSnapshot(state, { ...defaultAiSettings, weeklyAvailableMinutes: 420, targetUtilization: 60 }, "2026-11-02", [], now, "all");
  const output = offlineAiProposal(snapshot);
  for (const [i, entry] of output.entries.entries()) {
    const dayIndex = Math.floor(i / 2), offset = Math.floor(dayIndex / 5) * 7 + dayIndex % 5;
    const day = new Date(Date.parse("2026-11-02T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
    entry.proposedStart = { day, hour: 9 + i % 2, minute: 0 }; entry.proposedEnd = { day, hour: 10 + i % 2, minute: 0 }; entry.deferredReason = null;
    entry.estimatedImpact = i === count - 1 ? "Critical" : "Low";
  }
  output.weeklyWorkloads = computeWorkloads(snapshot, output.entries);
  return { snapshot, output };
}
function repair(snapshot: AiSnapshot, output: ReturnType<typeof offlineAiProposal>) {
  const result = fitAiProposalCapacity(snapshot, output, now);
  expect(result).not.toBeNull(); expect(validateAiProposal(snapshot, result, now).valid).toBe(true);
  return result!;
}
describe("reviewable backend capacity adjustments of Muse proposals", () => {
  it("fits the reported 7-hour/60% case across weeks, counts completed work and defers overflow", () => {
    const { snapshot, output } = fixture(), original = structuredClone({ snapshot, output });
    expect(validateAiProposal(snapshot, output, now)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([{ code: "AI_WEEKLY_CAPACITY", detail: expect.any(String) }]) });
    const result = repair(snapshot, output);
    expect(result.weeklyWorkloads.every(week => week.totalMinutes <= 240)).toBe(true);
    expect(result.weeklyWorkloads[0].existingMinutes).toBe(60);
    expect(result.entries.filter(entry => entry.proposedStart)).toHaveLength(15);
    expect(result.entries.filter(entry => !entry.proposedStart)).toHaveLength(8);
    expect(result.tradeoffs[0]).toContain("Review this revised schedule before Apply Plan");
    expect({ snapshot, output }).toEqual(original);
    const critical = result.entries.find(entry => entry.estimatedImpact === "Critical")!;
    expect(critical.proposedStart?.day).toBe("2026-11-03"); // The completed Monday commitment is included when balancing days.
    for (const entry of result.entries) {
      const previous = output.entries.find(item => item.taskId === entry.taskId)!;
      for (const key of ["estimatedImpact", "recommendedPriority", "estimatedMinutes", "impactConfidence", "effortConfidence", "impactRationale", "effortRationale", "dependencies"] as const) expect(entry[key]).toEqual(previous[key]);
    }
    expect(fitAiProposalCapacity(snapshot, output, now)).toEqual(result);
  });
  it("supplies exact remaining weekly minutes to Muse, including protected completed work", () => {
    const { snapshot } = fixture();
    expect(compactPlannerMuseInput(snapshot).input.capacityByWeek).toEqual([
      { weekStart: "2026-11-02", existingMinutes: 60, remainingMinutes: 180 },
      ...["2026-11-09", "2026-11-16", "2026-11-23"].map(weekStart => ({ weekStart, existingMinutes: 0, remainingMinutes: 240 })),
    ]);
  });
  it("does not change a valid proposal or repair unknown IDs, cycles or business mismatches", () => {
    const { snapshot, output } = fixture();
    expect(fitAiProposalCapacity(snapshot, offlineAiProposal(snapshot), now)).toBeNull();
    const mutations: Array<(entries: AiPlanEntry[]) => void> = [
      entries => { entries[0].taskId = "00000000-0000-4000-8000-000000001000"; },
      entries => { entries[0].dependencies.required = [entries[1].taskId]; entries[1].dependencies.required = [entries[0].taskId]; },
    ];
    for (const mutate of mutations) { const invalid = structuredClone(output); mutate(invalid.entries); expect(fitAiProposalCapacity(snapshot, invalid, now)).toBeNull(); }
    expect(fitAiProposalCapacity(snapshot, { ...output, businessId: "another-business" }, now)).toBeNull();
  });
  it("also fits overlapping, past, weekend and dependency-order suggestions without relaxing any rule", () => {
    for (const kind of ["overlap", "past", "weekend", "dependency"] as const) {
      const { snapshot, output } = fixture();
      if (kind === "overlap") { output.entries[0].proposedStart = output.entries[1].proposedStart; output.entries[0].proposedEnd = output.entries[1].proposedEnd; }
      if (kind === "past" || kind === "weekend") {
        const day = kind === "past" ? "2026-11-01" : "2026-11-07";
        output.entries[0].proposedStart = { day, hour: 9, minute: 0 }; output.entries[0].proposedEnd = { day, hour: 10, minute: 0 };
      }
      if (kind === "dependency") output.entries[0].dependencies.required = [output.entries[1].taskId];
      output.weeklyWorkloads = computeWorkloads(snapshot, output.entries);
      repair(snapshot, output);
    }
  });
  it("honors required prerequisites and completed prerequisites without inventing new dependency edges", () => {
    const { snapshot, output } = fixture();
    output.entries[1].dependencies.required = [output.entries[0].taskId]; // Already ordered in the original, so capacity-only repair is allowed.
    output.entries[2].dependencies.required = [snapshot.tasks[0].id]; // Completed work satisfies it, regardless of its historical scheduled hour.
    output.entries[1].estimatedImpact = "Critical";
    const result = repair(snapshot, output), a = result.entries[0], b = result.entries[1];
    expect(a.proposedEnd).not.toBeNull(); expect(b.proposedStart).not.toBeNull();
    expect(a.proposedEnd!.day <= b.proposedStart!.day).toBe(true);
    expect(b.dependencies).toEqual(output.entries[1].dependencies);
  });
  it("keeps deliberate Muse deferrals and defers estimates that cannot fit the daily hard limit", () => {
    const { snapshot, output } = fixture();
    output.entries[0].proposedStart = null; output.entries[0].proposedEnd = null; output.entries[0].deferredReason = "Muse recommends waiting for better evidence.";
    output.entries[1].estimatedMinutes = 180; output.entries[1].proposedEnd = { ...output.entries[1].proposedStart!, hour: 13 };
    // Leave a gap to avoid overlap; overflow alone is eligible for adjustment.
    output.entries[1].proposedStart = { day: "2026-11-02", hour: 10, minute: 0 };
    output.weeklyWorkloads = computeWorkloads(snapshot, output.entries);
    const result = repair(snapshot, output);
    expect(result.entries[0]).toEqual(output.entries[0]);
    expect(result.entries[1]).toMatchObject({ estimatedMinutes: 180, proposedStart: null, proposedEnd: null, deferredReason: expect.any(String) });
  });
});
