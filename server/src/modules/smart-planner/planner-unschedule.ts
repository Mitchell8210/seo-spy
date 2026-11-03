import type { PlannerState } from "./planner.types.js";

/** Clear calendar placements, including Done tasks, without reopening work. */
export function clearPlannerSchedules(state: PlannerState): number {
  let count = 0;
  const now = new Date().toISOString();
  for (const task of state.tasks) if (task.schedule) {
    task.schedule = null; task.scheduledBy = null; task.updatedAt = now; count++;
  }
  return count;
}
