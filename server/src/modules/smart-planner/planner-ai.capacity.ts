import { canonical } from "./planner.types.js";
import { computeWorkloads, localPlannerClock, plusDays, validateAiProposal, weeklyBudget, type AiPlanEntry, type AiPlanOutput, type AiSnapshot } from "./planner-ai.domain.js";

/** A new reviewable proposal, never a task write or another provider request.
 * Only placement violations are eligible. Identity, dependency definitions and
 * source facts cannot be repaired; the revised result must pass all rules again.
 */
export function fitAiProposalCapacity(snapshot: AiSnapshot, value: AiPlanOutput, now: Date): AiPlanOutput | null {
  const initial = validateAiProposal(snapshot, value, now);
  const placementCodes = ["AI_WEEKLY_CAPACITY", "AI_DAILY_CAPACITY", "AI_INTERVAL_OVERLAP", "AI_PAST_START", "AI_WORKING_DAY_INVALID", "AI_DEPENDENCY_ORDER", "AI_INTERVAL_INVALID"];
  if (initial.valid || initial.diagnostics.some(item => !placementCodes.includes(item.code))) return null;
  const output = structuredClone(value), known = new Map(snapshot.tasks.map(task => [task.id, task]));
  const entries = new Map(output.entries.map(entry => [entry.taskId, entry]));
  const minute = (point: { hour: number; minute?: number }) => point.hour * 60 + (point.minute ?? 0);
  const occupied = snapshot.tasks.filter(task => task.protected && task.schedule).map(task => ({ day: task.schedule!.day, start: minute(task.schedule!), end: minute(task.schedule!) + task.estimatedMinutes, duration: task.estimatedMinutes }));
  const clock = localPlannerClock(now, snapshot.timeZone), handled = new Set<string>();
  let changed = false;
  const process = (entry: AiPlanEntry) => {
    if (handled.has(entry.taskId)) return;
    handled.add(entry.taskId); // Cycles/unknown identities were rejected above.
    for (const id of entry.dependencies.required) { const prerequisite = entries.get(id); if (prerequisite) process(prerequisite); }
    if (!entry.proposedStart) return; // Preserve Muse's deliberate deferrals.
    const original = entry.proposedStart;
    entry.proposedStart = null; entry.proposedEnd = null;
    entry.deferredReason = "No continuous slot fits the remaining daily/weekly capacity and planning horizon, or a required prerequisite cannot be scheduled.";
    const prerequisites = entry.dependencies.required.filter(id => known.get(id)?.status !== "Done").map(id => {
      const candidate = entries.get(id), task = known.get(id);
      return candidate ? candidate.proposedEnd : task?.schedule ? { day: task.schedule.day, hour: 0, minute: minute(task.schedule) + task.estimatedMinutes } : null;
    });
    if (prerequisites.every(point => point !== null)) {
      for (let week = 0; week < snapshot.settings.horizonWeeks && !entry.proposedStart; week++) {
        const weekStart = plusDays(snapshot.planningWindow.start, week * 7), weekEnd = plusDays(weekStart, 7);
        const used = occupied.filter(item => item.day >= weekStart && item.day < weekEnd).reduce((sum, item) => sum + item.duration, 0);
        if (used + entry.estimatedMinutes > weeklyBudget(snapshot.settings)) continue;
        const load = (day: string) => occupied.filter(item => item.day === day).reduce((sum, item) => sum + item.duration, 0);
        const days = Array.from({ length: 7 }, (_, i) => plusDays(weekStart, i)).filter(day => day >= clock.day && snapshot.settings.workingDays.includes(new Date(`${day}T12:00:00Z`).getUTCDay() || 7));
        days.sort((a, b) => load(a) - load(b) || a.localeCompare(b));
        for (const day of days) {
          const work = occupied.filter(item => item.day === day);
          if (load(day) + entry.estimatedMinutes > snapshot.settings.dailyLimitMinutes || work.length >= snapshot.maxTasksPerDay) continue;
          for (let start = 540; start + entry.estimatedMinutes <= 1020; start += 30) {
            const end = start + entry.estimatedMinutes;
            if (day === clock.day && start < clock.minute || work.some(item => start < item.end && end > item.start)
              || prerequisites.some(point => point!.day > day || point!.day === day && minute(point!) > start)) continue;
            entry.proposedStart = { day, hour: Math.floor(start / 60), minute: start % 60 as 0 | 30 };
            entry.proposedEnd = { day, hour: Math.floor(end / 60), minute: end % 60 as 0 | 30 };
            entry.deferredReason = null; occupied.push({ day, start, end, duration: entry.estimatedMinutes }); break;
          }
          if (entry.proposedStart) break;
        }
      }
    }
    if (canonical(original) !== canonical(entry.proposedStart)) {
      changed = true;
      entry.schedulingRationale = `Backend adjusted this placement to respect capacity and prerequisites. ${entry.schedulingRationale}`.slice(0, 800);
    }
  };
  const impact = ["Critical", "High", "Medium", "Low"], priority = ["Urgent", "Medium", "Low"];
  for (const entry of [...output.entries].sort((a, b) => impact.indexOf(a.estimatedImpact) - impact.indexOf(b.estimatedImpact)
    || priority.indexOf(a.recommendedPriority) - priority.indexOf(b.recommendedPriority) || a.taskId.localeCompare(b.taskId))) process(entry);
  if (!changed) return null;
  output.weeklyWorkloads = computeWorkloads(snapshot, output.entries);
  output.tradeoffs.unshift("Backend adjusted proposed dates to fit working hours, dependencies and daily/weekly capacity, retaining Muse's impact, priority and effort estimates. Review this revised schedule before Apply Plan.");
  const final = validateAiProposal(snapshot, output, now);
  return final.valid ? final.output : null;
}
