import { ConflictException, Inject, Injectable, Optional, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { canonical, checksum } from "./planner.types.js";
import { PLANNER_CLOCK, PlannerService } from "./planner.service.js";
import { PlannerAiStore, type AiProposalRecord } from "./planner-ai.store.js";
import { PlannerAiGateway, PlannerAiGenerationError, type PlannerFrontendContext } from "./planner-ai.gateway.js";
import { PlannerMuseError } from "./planner-muse.request.js";
import { PLANNER_COMPACT_PROMPT_VERSION } from "./planner-muse.compact.js";
import { fitAiProposalCapacity } from "./planner-ai.capacity.js";
import { aiSettingsSchema, makeAiSnapshot, plannerStateHash, PLANNER_AI_PROMPT_VERSION, PLANNER_AI_SCHEMA_VERSION, snapshotHash, validateAiProposal, weeklyBudget } from "./planner-ai.domain.js";
import type { ApplyAiPlanDto, GenerateAiPlanDto, UpdateAiSettingsDto } from "./planner-ai.dto.js";

const conflict = (message = "The planner or source evidence changed. Generate and review a new AI proposal.") => new ConflictException({ code: "AI_PROPOSAL_STALE", message });
@Injectable()
export class PlannerAiService {
  constructor(private readonly planner: PlannerService, private readonly store: PlannerAiStore, private readonly gateway: PlannerAiGateway, @Optional() @Inject(PLANNER_CLOCK) private readonly clock?: () => Date) {}
  private now() { return this.clock?.() ?? new Date(); }
  async preferences(businessId: string) {
    const planner = await this.planner.read(businessId), settings = this.store.settings(businessId);
    return { businessId, plannerRevision: planner.revision, settings, weeklyBudgetMinutes: weeklyBudget(settings) };
  }
  async savePreferences(businessId: string, body: UpdateAiSettingsDto) {
    const parsed = aiSettingsSchema.safeParse(body.settings);
    if (!parsed.success || weeklyBudget(parsed.data) < 30) throw new UnprocessableEntityException({ code: "AI_SETTINGS_INVALID", message: "Choose settings with at least thirty minutes of effective weekly capacity." });
    await this.planner.saveAiSettings(businessId, body, () => this.store.saveSettings(businessId, parsed.data));
    return this.preferences(businessId);
  }
  private async view(record: AiProposalRecord) {
    const current = await this.planner.read(record.businessId);
    return { id: record.id, businessId: record.businessId, plannerRevision: record.snapshot.plannerRevision, mode: record.mode, model: record.model, status: record.status,
      createdAt: record.createdAt, expiresAt: record.expiresAt, appliedAt: record.appliedAt, promptVersion: record.promptVersion, schemaVersion: record.schemaVersion, snapshotHash: record.snapshotHash,
      stale: record.status !== "applied" && (plannerStateHash(current) !== record.snapshot.stateHash || canonical(this.store.settings(record.businessId)) !== canonical(record.snapshot.settings)),
      expired: this.now().toISOString() >= record.expiresAt, settings: record.snapshot.settings, weeklyBudgetMinutes: weeklyBudget(record.snapshot.settings), tasks: record.snapshot.tasks, output: record.output, diagnostics: record.diagnostics };
  }
  async get(businessId: string, id: string) { return this.view(this.store.get(businessId, id)); }
  async latest(businessId: string) {
    await this.planner.read(businessId);
    const record = this.store.latest(businessId); return record ? this.view(record) : null;
  }
  async generate(businessId: string, body: GenerateAiPlanDto, frontend?: PlannerFrontendContext) {
    const requestHash = checksum(canonical(body));
    const existing = this.store.findMutation(businessId, body.mutationId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw conflict("This generation ID was already used with different parameters. No new model request was made.");
      return this.view(existing);
    }
    const current = await this.planner.read(businessId);
    if (current.revision !== body.expectedRevision) throw conflict();
    let snapshot;
    try { snapshot = makeAiSnapshot(current, this.store.settings(businessId), body.weekStart, body.reconsiderTaskIds ?? [], this.now(), body.scope); }
    catch (error) { throw new UnprocessableEntityException({ code: error instanceof Error ? error.message : "AI_SNAPSHOT_INVALID", message: "Planning needs a confirmed time zone, a valid future planning window, eligible tasks and permitted schedule selections. At most 60 tasks can be evaluated at once." }); }
    const now = this.now(), createdAt = now.toISOString();
    const record: AiProposalRecord = { id: randomUUID(), businessId, mutationId: body.mutationId, requestHash, createdAt, expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(), promptVersion: body.mode === "live" && frontend ? PLANNER_COMPACT_PROMPT_VERSION : PLANNER_AI_PROMPT_VERSION, schemaVersion: PLANNER_AI_SCHEMA_VERSION,
      snapshot, snapshotHash: snapshotHash(snapshot), mode: body.mode, model: null, status: "generating", output: null, diagnostics: [], appliedAt: null, applicationMutationId: null, applicationRequestHash: null, requestIdentity: null, accountingAttemptId: null };
    const reserved = this.store.reserve(record);
    if (!reserved.created) return this.view(reserved.record);
    try {
      const generated = await this.gateway.generate(structuredClone(snapshot), body.mode, record.id, frontend);
      const validation = validateAiProposal(snapshot, generated.output, this.now());
      record.model = generated.model; record.requestIdentity = generated.requestIdentity; record.accountingAttemptId = generated.accountingAttemptId;
      if (validation.valid) { record.status = "ready"; record.output = validation.output; }
      else {
        const revised = body.mode === "live" ? fitAiProposalCapacity(snapshot, generated.output, this.now()) : null;
        if (revised) { record.status = "ready"; record.output = revised; }
        else { record.status = "invalid"; record.diagnostics = validation.diagnostics; }
      }
    } catch (error) {
      const approval = error instanceof PlannerAiGenerationError && ["AI_PLANNING_APPROVAL_REQUIRED", "AI_PLANNING_ALLOWANCE_UNAVAILABLE"].includes(error.code);
      record.status = approval ? "approval_required" : "failed";
      record.diagnostics = [{ code: error instanceof PlannerMuseError ? error.code : "AI_GENERATION_FAILED", detail: error instanceof PlannerMuseError ? error.message : "Generation failed or its outcome is uncertain. It was not automatically retried; no planner changes were made." },
        ...(error instanceof PlannerMuseError ? error.diagnostics.slice(0, 10) : [])];
      if (error instanceof PlannerMuseError && error.receipt) {
        record.model = error.receipt.model; record.requestIdentity = error.receipt.requestIdentity; record.accountingAttemptId = error.receipt.accountingAttemptId;
      }
    }
    this.store.update(record);
    return this.view(record);
  }
  async apply(businessId: string, id: string, body: ApplyAiPlanDto) {
    const record = this.store.get(businessId, id), applicationHash = checksum(canonical(body));
    if (record.status === "applied") {
      if (record.applicationMutationId !== body.mutationId || record.applicationRequestHash !== applicationHash) throw conflict("This proposal was already applied. Reload the current planner; it was not applied again.");
      return this.planner.read(businessId);
    }
    if (record.status !== "ready" || !record.output || this.now().toISOString() >= record.expiresAt || snapshotHash(record.snapshot) !== record.snapshotHash || body.expectedRevision !== record.snapshot.plannerRevision) throw conflict();
    const validation = validateAiProposal(record.snapshot, record.output, this.now());
    if (!validation.valid) throw new UnprocessableEntityException({ code: "AI_PROPOSAL_INVALID", message: "The proposal no longer satisfies scheduling rules. Generate a new proposal.", diagnostics: validation.diagnostics });
    const output = validation.output;
    return this.planner.applyReviewedAiPlan(businessId, { ...body, proposalId: id }, (state, current) => {
        if (plannerStateHash(current) !== record.snapshot.stateHash || canonical(this.store.settings(businessId)) !== canonical(record.snapshot.settings)) throw conflict();
        for (const entry of output.entries) {
          const task = state.tasks.find(task => task.id === entry.taskId);
          if (!task || task.status === "Done") throw conflict();
          task.priority = entry.recommendedPriority; task.estimatedDurationMinutes = entry.estimatedMinutes;
          task.durationEstimateSource = record.mode === "live" ? "muse-estimate" : "offline-estimate";
          task.payloadVersion = 2; task.schedule = entry.proposedStart;
          task.scheduledBy = task.schedule ? record.mode === "live" ? "muse" : "offline-preview" : null;
          task.updatedAt = this.now().toISOString();
          // Accepted AI working days may include weekends; show those approved placements.
          if (task.schedule && [0, 6].includes(new Date(`${task.schedule.day}T12:00:00Z`).getUTCDay())) state.useWeekends = true;
        }
        record.status = "applied"; record.appliedAt = this.now().toISOString(); record.applicationMutationId = body.mutationId; record.applicationRequestHash = applicationHash;
        this.store.update(record); // Nested in the same planner SQLite transaction and receipt.
    });
  }
}
