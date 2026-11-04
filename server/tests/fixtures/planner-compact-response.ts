import { offlineAiProposal, type AiPlanOutput, type AiSnapshot } from "../../src/modules/smart-planner/planner-ai.domain.js";
/** Offline model response fixture, not production-generated AI content. */
export function compactPlannerFixture(snapshot: AiSnapshot, plan: AiPlanOutput = offlineAiProposal(snapshot)) {
  const ref = (id: string) => snapshot.tasks.findIndex(task => task.id === id);
  return { version: "planner-compact-v2", rows: plan.entries.map(entry => ({ taskRef: ref(entry.taskId), priority: entry.recommendedPriority, impact: entry.estimatedImpact, minutes: entry.estimatedMinutes,
    start: entry.proposedStart ? { dayOffset: Math.round((Date.parse(`${entry.proposedStart.day}T12:00:00Z`) - Date.parse(`${snapshot.planningWindow.start}T12:00:00Z`)) / 86400000),
      startSlot: (entry.proposedStart.hour * 60 + entry.proposedStart.minute - 540) / 30 } : null, reasonRef: entry.proposedStart ? 0 : 1 })),
    reasons: ["Prioritize supported SEO impact; effort allows reviewing and testing the saved guidance.", "No continuous slot fits daily/weekly capacity; defer rather than overload."], impactConfidence: "Low", effortConfidence: "Low",
    dependencies: plan.entries.filter(entry => entry.dependencies.required.length || entry.dependencies.suggested.length).map(entry => ({ task: ref(entry.taskId), required: entry.dependencies.required.map(ref), suggested: entry.dependencies.suggested.map(ref) })),
    assumptions: ["Human effort estimates are uncertain; allow time for review."], tradeoffs: ["Preserve completed work and workload headroom."], rationale: "Prioritize meaningful SEO work within sustainable weekly and daily budgets." };
}
