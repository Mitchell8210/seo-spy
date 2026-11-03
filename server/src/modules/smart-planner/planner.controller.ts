import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorDto } from "../../contracts/responses.dto.js";
import { AutoPlanDto, CreatePlannerTaskDto, DeletePlannerTaskDto, PlannerMutationDto, PlannerResponseDto, ReconcilePlannerDto, UpdatePlannerPreferencesDto, UpdatePlannerTaskDto } from "./planner.dto.js";
import { PlannerService } from "./planner.service.js";

@Controller("businesses/:businessId/smart-planner")
@ApiTags("Smart Planner")
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}
  @Get() @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Read planner choices and saved-source tasks without starting collection" })
  read(@Param("businessId") businessId: string) { return this.planner.read(businessId); }
  @Post("tasks") @ApiCreatedResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Create a durable custom planner task" })
  create(@Param("businessId") businessId: string, @Body() body: CreatePlannerTaskDto) { return this.planner.create(businessId, body); }
  @Patch("tasks/:taskId") @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Save a task schedule or user-asserted completion without external verification" })
  update(@Param("businessId") businessId: string, @Param("taskId", ParseUUIDPipe) taskId: string, @Body() body: UpdatePlannerTaskDto) { return this.planner.update(businessId, taskId, body); }
  @Post("tasks/:taskId/undo-completion") @HttpCode(200) @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Explicitly undo Done; preserve the schedule, original guidance and completion history" })
  undoCompletion(@Param("businessId") businessId: string, @Param("taskId", ParseUUIDPipe) taskId: string, @Body() body: PlannerMutationDto) { return this.planner.undoCompletion(businessId, taskId, body); }
  @Delete("tasks/:taskId") @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Delete a confirmed user-created custom task; report tasks are protected" })
  deleteCustom(@Param("businessId") businessId: string, @Param("taskId", ParseUUIDPipe) taskId: string, @Body() body: DeletePlannerTaskDto) { return this.planner.deleteCustom(businessId, taskId, body); }
  @Patch("preferences") @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Save weekend preference and atomically clear weekend schedules when disabled" })
  preferences(@Param("businessId") businessId: string, @Body() body: UpdatePlannerPreferencesDto) { return this.planner.preferences(businessId, body); }
  @Post("unschedule-all") @HttpCode(200) @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Atomically unschedule all tasks; preserve completion history and guidance" })
  unscheduleAll(@Param("businessId") businessId: string, @Body() body: PlannerMutationDto) { return this.planner.unscheduleAll(businessId, body); }
  @Post("auto-plan") @HttpCode(200) @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Persist the deterministic scheduling rules without calling AI" })
  autoPlan(@Param("businessId") businessId: string, @Body() body: AutoPlanDto) { return this.planner.autoPlan(businessId, body); }
  @Post("reconcile") @HttpCode(200) @ApiOkResponse({ type: PlannerResponseDto })
  @ApiOperation({ summary: "Reconcile saved Website, Facebook and consistency evidence; preserve completed history" })
  reconcile(@Param("businessId") businessId: string, @Body() body: ReconcilePlannerDto) { return this.planner.reconcile(businessId, body); }
}
