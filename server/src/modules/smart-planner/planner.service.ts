import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BUSINESS_REPOSITORY, SMART_PLANNER_REPOSITORY, type BusinessRepository, type PlannerRepository } from "../../persistence/repositories.js";
import type { AutoPlanDto, CreatePlannerTaskDto, PlannerResponseDto, ReconcilePlannerDto, UpdatePlannerPreferencesDto, UpdatePlannerTaskDto } from "./planner.dto.js";
import { schedulePlannerV2 } from "./planner-scheduler-v2.js";
import { PlannerSourcesService, type PlannerSourceProjection } from "./planner-sources.js";
import { canonical, checksum, scheduleSchema, sourceTaskId, validDay, validPlannerTimeZone, weekend, type PlannerMutation, type PlannerSchedule, type PlannerState } from "./planner.types.js";

const bad = (message: string) => new BadRequestException({ code: "PLANNER_INPUT_INVALID", message });
const visible = (state: PlannerState) => state.tasks.filter(task => task.mode === "custom" || task.status === "Done" || task.sourcePresent);
export const PLANNER_CLOCK = Symbol("PLANNER_CLOCK");

@Injectable()
export class PlannerService {
  constructor(@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
    @Inject(SMART_PLANNER_REPOSITORY) private readonly repository: PlannerRepository,
    private readonly sources: PlannerSourcesService,
    @Optional() @Inject(PLANNER_CLOCK) private readonly clock?: () => Date) {}
  private async context(businessId: string): Promise<PlannerSourceProjection> {
    if (!await this.businesses.findById(businessId)) throw new NotFoundException({ code: "BUSINESS_NOT_FOUND", message: "Business not found." });
    return this.sources.read(businessId);
  }
  private merge(state: PlannerState, projection: PlannerSourceProjection): void {
    const current = new Set<string>();
    const now = new Date().toISOString();
    for (const task of projection.tasks) {
      const id = sourceTaskId(state.businessId, task.origin);
      current.add(id);
      const previous = state.tasks.find(item => item.id === id);
      if (previous) {
        // Never replace the guidance, provenance or timestamp the user completed.
        previous.sourcePresent = true;
        continue;
      }
      state.tasks.push({ id, taskKey: `${task.taskKey}@${id}`, orderKey: task.taskKey,
        title: task.title, explanation: task.explanation, guidance: task.guidance, priority: task.priority, category: task.category,
        source: task.source, mode: task.mode, status: "Needs Action", schedule: null, destination: task.destination ?? null, notes: null,
        origin: task.origin, sourceChannel: task.origin.channel, sourcePresent: true, completedAt: null, createdAt: now, updatedAt: now,
        payloadVersion: 2, estimatedDurationMinutes: 60, durationEstimateSource: "default", scheduledBy: null });
    }
    for (const task of state.tasks) {
      if (task.mode === "custom" || current.has(task.id)) continue;
      const channel = projection.sources.find(source => source.channel === task.sourceChannel);
      if (channel && ["available", "empty"].includes(channel.availability)) task.sourcePresent = false;
      // Pending, failed and unavailable sources do not erase any previous work.
    }
    // Match current source order, then retained history/custom tasks in creation order.
    const order = new Map(projection.tasks.map((task, index) => [sourceTaskId(state.businessId, task.origin), index]));
    state.tasks.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }
  private response(state: PlannerState, projection: PlannerSourceProjection): PlannerResponseDto {
    return { businessId: state.businessId, revision: state.revision, preferences: { useWeekends: state.useWeekends, dailyCapacityMinutes: state.dailyCapacityMinutes, maxTasksPerDay: state.maxTasksPerDay, horizonWeeks: state.horizonWeeks, timeZone: state.timeZone },
      tasks: visible(state).map(({ id, taskKey, title, explanation, guidance, priority, category, source, mode, status, schedule, destination, notes, completedAt, origin, estimatedDurationMinutes, durationEstimateSource, scheduledBy }) =>
        ({ id, taskKey, title, explanation, guidance, priority, category, source, mode, status, schedule, destination, notes, completedAt, origin,
          estimatedDurationMinutes: estimatedDurationMinutes ?? 60, durationEstimateSource: durationEstimateSource ?? "legacy-default", scheduledBy: scheduledBy ?? (schedule ? "legacy-unknown" : null) })),
      sources: projection.sources, ...(state.mutationResult ? { planning: state.mutationResult } : {}) };
  }
  async read(businessId: string): Promise<PlannerResponseDto> {
    const projection = await this.context(businessId);
    const state = await this.repository.read(businessId);
    this.merge(state, projection);
    return this.response(state, projection);
  }
  private async write(businessId: string, operation: string, body: PlannerMutation, apply: (state: PlannerState) => void): Promise<PlannerResponseDto> {
    const projection = await this.context(businessId);
    const state = await this.repository.mutate(businessId, body, checksum(canonical({ operation, body })), current => {
      this.merge(current, projection);
      apply(current);
    });
    this.merge(state, projection);
    return this.response(state, projection);
  }
  private schedule(state: PlannerState, value: PlannerSchedule | null | undefined, duration = 60): PlannerSchedule | null {
    if (value == null) return null;
    const parsed = scheduleSchema.safeParse(value);
    if (!parsed.success) throw bad("Supply a real calendar date and a half-hour start from 09:00 to 16:30.");
    if (!state.useWeekends && weekend(value.day)) throw bad("Enable Use Weekends before scheduling on Saturday or Sunday.");
    if (value.hour * 60 + (value.minute ?? 0) + duration > 17 * 60) throw bad("The full task duration must fit before 17:00. Choose an earlier start or a shorter estimate.");
    return parsed.data;
  }
  create(businessId: string, body: CreatePlannerTaskDto): Promise<PlannerResponseDto> {
    return this.write(businessId, "create", body, state => {
      const id = randomUUID(), now = new Date().toISOString(), notes = body.notes?.trim() ?? "";
      state.tasks.push({ id, taskKey: `custom:${id}`, orderKey: `custom:${id}`, title: body.title.trim(),
        explanation: notes, guidance: notes || "Complete the work you described, then mark this custom task Done.",
        priority: body.priority, category: body.category, source: "Custom task", mode: "custom", status: "Needs Action",
        schedule: this.schedule(state, body.schedule, body.estimatedDurationMinutes ?? 60), destination: null, notes, origin: null, sourceChannel: null, sourcePresent: true,
        completedAt: null, createdAt: now, updatedAt: now, payloadVersion: 2, estimatedDurationMinutes: body.estimatedDurationMinutes ?? 60,
        durationEstimateSource: body.estimatedDurationMinutes === undefined ? "default" : "user", scheduledBy: body.schedule ? "manual" : null });
    });
  }
  update(businessId: string, id: string, body: UpdatePlannerTaskDto): Promise<PlannerResponseDto> {
    if (body.status === undefined && body.schedule === undefined && body.estimatedDurationMinutes === undefined) throw bad("Supply a planner status, estimate or schedule change.");
    if (body.status === "Done" && body.completionConfirmed !== true) throw bad("Confirm that you completed these steps before marking the task Done.");
    return this.write(businessId, `update:${id}`, body, state => {
      const task = visible(state).find(item => item.id === id);
      if (!task) throw new NotFoundException({ code: "PLANNER_TASK_NOT_FOUND", message: "Planner task not found for this business." });
      if (task.status === "Done" && body.status === "Needs Action") throw bad("Completed task history is preserved; saved findings cannot reopen completed work.");
      if (body.estimatedDurationMinutes !== undefined) {
        if (task.status === "Done") throw bad("Completed task estimates are read-only so their history is preserved.");
        task.payloadVersion = 2; task.estimatedDurationMinutes = body.estimatedDurationMinutes; task.durationEstimateSource = "user";
      }
      if (body.schedule !== undefined) { task.schedule = this.schedule(state, body.schedule, task.estimatedDurationMinutes ?? 60); task.scheduledBy = task.schedule ? "manual" : null; }
      else if (body.estimatedDurationMinutes !== undefined && task.schedule) this.schedule(state, task.schedule, task.estimatedDurationMinutes);
      if (body.status === "Done" && task.status !== "Done") { task.status = "Done"; task.completedAt = new Date().toISOString(); }
      task.updatedAt = new Date().toISOString();
    });
  }
  preferences(businessId: string, body: UpdatePlannerPreferencesDto): Promise<PlannerResponseDto> {
    const keys = ["useWeekends", "dailyCapacityMinutes", "maxTasksPerDay", "horizonWeeks", "timeZone"] as const;
    if (keys.every(key => body[key] === undefined)) throw bad("Supply at least one planning preference.");
    if (body.timeZone !== undefined && !validPlannerTimeZone(body.timeZone)) throw bad("Choose a valid IANA planning time zone.");
    return this.write(businessId, "preferences", body, state => {
      if (body.useWeekends !== undefined) state.useWeekends = body.useWeekends;
      if (body.dailyCapacityMinutes !== undefined) state.dailyCapacityMinutes = body.dailyCapacityMinutes;
      if (body.maxTasksPerDay !== undefined) state.maxTasksPerDay = body.maxTasksPerDay;
      if (body.horizonWeeks !== undefined) state.horizonWeeks = body.horizonWeeks;
      if (body.timeZone !== undefined) state.timeZone = body.timeZone;
      if (body.useWeekends === false) for (const task of state.tasks) if (task.schedule && weekend(task.schedule.day)) {
        task.schedule = null; task.scheduledBy = null; task.updatedAt = new Date().toISOString();
      }
    });
  }
  autoPlan(businessId: string, body: AutoPlanDto): Promise<PlannerResponseDto> {
    if (!validDay(body.weekStart) || new Date(`${body.weekStart}T12:00:00Z`).getUTCDay() !== 1) throw bad("Auto Plan requires a valid Monday calendar date.");
    return this.write(businessId, "auto-plan", body, state => {
      const tasks = visible(state);
      if (!state.timeZone) throw bad("Save Planning settings and confirm your time zone before using Auto Plan.");
      let planned;
      try {
        planned = schedulePlannerV2(tasks.map(task => ({ ...task, sortKey: task.orderKey })), { weekStart: body.weekStart, useWeekends: state.useWeekends, dailyCapacityMinutes: state.dailyCapacityMinutes, maxTasksPerDay: state.maxTasksPerDay, horizonWeeks: state.horizonWeeks, timeZone: state.timeZone, now: this.clock?.() ?? new Date() });
      } catch (error) { throw bad(error instanceof Error ? error.message : "The planning range or settings are invalid."); }
      for (const task of tasks) if (planned.assignments[task.id] && task.status === "Needs Action" && !task.schedule) {
        task.schedule = planned.assignments[task.id]; task.scheduledBy = "auto"; task.updatedAt = new Date().toISOString();
      }
      state.mutationResult = { policyVersion: planned.policyVersion, range: planned.range, scheduledCount: Object.keys(planned.assignments).length, remaining: planned.remaining, overloadedDays: planned.overloadedDays };
    });
  }
  reconcile(businessId: string, body: ReconcilePlannerDto): Promise<PlannerResponseDto> {
    return this.write(businessId, "reconcile", body, () => { /* Saved evidence never reopens completed work. */ });
  }
}
