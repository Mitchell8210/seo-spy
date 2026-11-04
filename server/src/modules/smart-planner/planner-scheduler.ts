export interface PlannerSchedule { day: string; hour: number }
export interface SchedulableTask {
  id: string;
  sortKey?: string;
  priority: "Urgent" | "Medium" | "Low";
  category: string;
  status: "Needs Action" | "Done";
  schedule?: PlannerSchedule | null;
}
export const plannerHours = [9, 10, 11, 12, 13, 14, 15, 16];
export function validPlannerDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
export function isWeekend(day: string): boolean { return [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()); }
export function weekDays(monday: string, weekends: boolean): string[] {
  return Array.from({ length: weekends ? 7 : 5 }, (_, index) => {
    const date = new Date(`${monday}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}
/** Exact client scheduling policy. Optional sortKey preserves legacy ordering for distinct historical identities. */
export function autoSchedule(tasks: SchedulableTask[], monday: string, weekends: boolean): Record<string, PlannerSchedule> {
  const days = weekDays(monday, weekends);
  const occupied = new Set(tasks.filter(task => task.schedule).map(task => `${task.schedule!.day}:${task.schedule!.hour}`));
  const load = days.map(day => tasks.filter(task => task.schedule?.day === day).length);
  const rank = { Urgent: 0, Medium: 1, Low: 2 };
  const pending = tasks.filter(task => task.status === "Needs Action" && !task.schedule)
    .sort((a, b) => rank[a.priority] - rank[b.priority] || Number(b.category === "Admin") - Number(a.category === "Admin") || (a.sortKey ?? a.id).localeCompare(b.sortKey ?? b.id));
  const planned: Record<string, PlannerSchedule> = {};
  for (const task of pending) {
    const available = days.map((day, index) => ({ day, index, hour: plannerHours.find(hour => !occupied.has(`${day}:${hour}`)) })).filter(slot => slot.hour !== undefined);
    const preference = task.priority === "Urgent" ? [0, 1, 2, 3, 4, 5, 6] : task.priority === "Low" ? [3, 4, 2, 1, 0, 5, 6] : [1, 2, 3, 4, 0, 5, 6];
    available.sort((a, b) => {
      const cost = (index: number) => task.category === "Admin" && index === 0 && load[0] < 2 ? -10 : load[index] * 3 + preference.indexOf(index);
      return cost(a.index) - cost(b.index) || a.index - b.index;
    });
    const slot = available[0];
    if (!slot || slot.hour === undefined) continue;
    planned[task.id] = { day: slot.day, hour: slot.hour };
    occupied.add(`${slot.day}:${slot.hour}`); load[slot.index]++;
  }
  return planned;
}
