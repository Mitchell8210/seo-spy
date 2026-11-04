import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsDivisibleBy, IsIn, IsInt, IsObject, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { PlannerMutationDto } from "./planner.dto.js";
export class AiSettingsDto {
  @ApiProperty({ minimum: 60, maximum: 2400, multipleOf: 30, default: 600 }) @IsInt() @Min(60) @Max(2400) @IsDivisibleBy(30) weeklyAvailableMinutes!: number;
  @ApiProperty({ minimum: 10, maximum: 90, default: 70 }) @IsInt() @Min(10) @Max(90) targetUtilization!: number;
  @ApiProperty({ minimum: 2, maximum: 52, default: 4 }) @IsInt() @Min(2) @Max(52) horizonWeeks!: number;
  @ApiProperty({ minimum: 30, maximum: 480, multipleOf: 30, default: 120 }) @IsInt() @Min(30) @Max(480) @IsDivisibleBy(30) dailyLimitMinutes!: number;
  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5], description: "ISO working days, Monday=1; applies only to AI proposals" }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) workingDays!: number[];
  @ApiProperty({ default: true }) @IsBoolean() protectExistingSchedules!: boolean;
}
export class UpdateAiSettingsDto extends PlannerMutationDto {
  @ApiProperty({ type: AiSettingsDto }) @IsObject() @ValidateNested() @Type(() => AiSettingsDto) settings!: AiSettingsDto;
}
export class GenerateAiPlanDto extends PlannerMutationDto {
  @ApiPropertyOptional({ enum: ["all", "unscheduled"], description: "Reorganize all unfinished tasks, or only plan unscheduled tasks. Server selects task IDs; cannot be combined with reconsiderTaskIds." }) @ValidateIf((_object, value: unknown) => value !== undefined) @IsIn(["all", "unscheduled"]) scope?: "all" | "unscheduled";
  @ApiProperty({ enum: ["mock", "live"], description: "Explicit mock is an offline simulation, never a fallback; authenticated explicit live generation uses the existing shared $25 cumulative AI budget" }) @IsIn(["mock", "live"]) mode!: "mock" | "live";
  @ApiProperty({ description: "Selected Monday civil date" }) @IsString() @MinLength(10) @MaxLength(10) weekStart!: string;
  @ApiPropertyOptional({ type: [String], description: "Explicit scheduled pending task IDs to reconsider, allowed only with protection disabled" }) @ValidateIf((_object, value: unknown) => value !== undefined) @IsArray() @ArrayMaxSize(60) @ArrayUnique() @IsUUID("all", { each: true }) reconsiderTaskIds?: string[];
}
export class ApplyAiPlanDto extends PlannerMutationDto {
  @ApiProperty({ enum: [true] }) @Equals(true) confirmed!: true;
}
export class AiSettingsResponseDto {
  @ApiProperty() businessId!: string;
  @ApiProperty() plannerRevision!: number;
  @ApiProperty({ type: AiSettingsDto }) settings!: AiSettingsDto;
  @ApiProperty({ description: "Hard weekly budget, rounded down to a supported half hour" }) weeklyBudgetMinutes!: number;
}
export class AiProposalResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty() plannerRevision!: number;
  @ApiProperty({ enum: ["mock", "live"] }) mode!: string;
  @ApiProperty({ enum: ["generating", "ready", "invalid", "failed", "approval_required", "applied"] }) status!: string;
  @ApiProperty() stale!: boolean;
  @ApiProperty() expired!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ description: "Unapplied proposals expire after seven days" }) expiresAt!: string;
  @ApiProperty({ nullable: true, type: String }) appliedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) model!: string | null;
  @ApiProperty() promptVersion!: string;
  @ApiProperty() schemaVersion!: string;
  @ApiProperty() snapshotHash!: string;
  @ApiProperty({ type: AiSettingsDto }) settings!: AiSettingsDto;
  @ApiProperty() weeklyBudgetMinutes!: number;
  @ApiProperty({ type: "array", items: { type: "object", additionalProperties: true }, description: "Sanitized immutable snapshot task labels, original priorities, source severities and protected commitments" }) tasks!: object[];
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true, description: "Strict planner-muse-proposal-v1 entries, impact/effort/dependencies, window, recomputed weekly workloads, rationale and tradeoffs; see prompt/schema contract" }) output!: object | null;
  @ApiProperty({ type: "array", items: { type: "object", properties: { code: { type: "string" }, detail: { type: "string" }, taskId: { type: "string" } } } }) diagnostics!: object[];
}
