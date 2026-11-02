import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { Equals, IsBoolean, IsDivisibleBy, IsIn, IsInt, IsObject, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { categories, durationOptions, priorities, statuses } from "./planner.types.js";

export class PlannerMutationDto {
  @ApiProperty({ minimum: 0, description: "Revision last read, or zero for an unpersisted planner" })
  @IsInt() @Min(0) expectedRevision!: number;
  @ApiProperty({ format: "uuid", description: "Unique submission ID; retain it for an identical retry" })
  @IsUUID() mutationId!: string;
}
export class PlannerScheduleDto {
  @ApiProperty({ example: "2026-11-02", description: "Local calendar date, YYYY-MM-DD" })
  @IsString() @MinLength(10) @MaxLength(10) day!: string;
  @ApiProperty({ minimum: 9, maximum: 16 })
  @IsInt() @Min(9) @Max(16) hour!: number;
  @ApiPropertyOptional({ enum: [0, 30], default: 0 })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsIn([0, 30]) minute?: 0 | 30;
}
export class CreatePlannerTaskDto extends PlannerMutationDto {
  @ApiProperty({ maxLength: 160 })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @ApiProperty({ enum: priorities }) @IsIn(priorities) priority!: typeof priorities[number];
  @ApiProperty({ enum: categories }) @IsIn(categories) category!: typeof categories[number];
  @ApiPropertyOptional({ enum: durationOptions, default: 60, description: "Planning estimate in minutes, not measured effort" })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsIn(durationOptions) estimatedDurationMinutes?: number;
  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ type: PlannerScheduleDto, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null) @IsObject() @ValidateNested() @Type(() => PlannerScheduleDto)
  schedule?: PlannerScheduleDto | null;
}
export class UpdatePlannerTaskDto extends PlannerMutationDto {
  @ApiPropertyOptional({ enum: durationOptions, description: "Editable only before completion" })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsIn(durationOptions) estimatedDurationMinutes?: number;
  @ApiPropertyOptional({ enum: statuses })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsIn(statuses) status?: typeof statuses[number];
  @ApiPropertyOptional({ enum: [true], description: "User assertion only, never verification" })
  @ValidateIf((_object, value: unknown) => value !== undefined) @Equals(true) completionConfirmed?: true;
  @ApiPropertyOptional({ type: PlannerScheduleDto, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null) @IsObject() @ValidateNested() @Type(() => PlannerScheduleDto)
  schedule?: PlannerScheduleDto | null;
}
export class UpdatePlannerPreferencesDto extends PlannerMutationDto {
  @ApiPropertyOptional() @ValidateIf((_object, value: unknown) => value !== undefined) @IsBoolean() useWeekends?: boolean;
  @ApiPropertyOptional({ minimum: 30, maximum: 480, multipleOf: 30, default: 120 })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsInt() @Min(30) @Max(480) @IsDivisibleBy(30) dailyCapacityMinutes?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 16, default: 3 })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsInt() @Min(1) @Max(16) maxTasksPerDay?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 12, default: 4 })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsInt() @Min(1) @Max(12) horizonWeeks?: number;
  @ApiPropertyOptional({ maxLength: 100, example: "America/Los_Angeles", description: "Explicitly confirmed IANA planning time zone" })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @MinLength(1) @MaxLength(100) timeZone?: string;
}
export class AutoPlanDto extends PlannerMutationDto {
  @ApiProperty({ example: "2026-11-02", description: "Monday local calendar date" })
  @IsString() @MinLength(10) @MaxLength(10) weekStart!: string;
}
export class ReconcilePlannerDto extends PlannerMutationDto {
  @ApiProperty({ enum: [true] }) @Equals(true) confirmed!: true;
}
export class PlannerTaskResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() taskKey!: string;
  @ApiProperty() title!: string;
  @ApiProperty() explanation!: string;
  @ApiProperty() guidance!: string;
  @ApiProperty({ enum: priorities }) priority!: typeof priorities[number];
  @ApiProperty({ enum: categories }) category!: typeof categories[number];
  @ApiProperty() source!: string;
  @ApiProperty({ enum: ["demo", "saved", "custom"] }) mode!: "demo" | "saved" | "custom";
  @ApiProperty({ enum: statuses }) status!: typeof statuses[number];
  @ApiProperty({ enum: durationOptions, description: "Planning estimate, never actual time spent" }) estimatedDurationMinutes!: number;
  @ApiPropertyOptional({ description: "Original finding severity, never model-estimated impact" }) sourceSeverity?: string;
  @ApiProperty({ enum: ["default", "legacy-default", "user", "muse-estimate", "offline-estimate"] }) durationEstimateSource!: "default" | "legacy-default" | "user" | "muse-estimate" | "offline-estimate";
  @ApiProperty({ enum: ["manual", "auto", "legacy-unknown", "muse", "offline-preview"], nullable: true }) scheduledBy!: "manual" | "auto" | "legacy-unknown" | "muse" | "offline-preview" | null;
  @ApiProperty({ type: PlannerScheduleDto, nullable: true }) schedule!: PlannerScheduleDto | null;
  @ApiProperty({ type: String, nullable: true }) destination!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" }) completedAt!: string | null;
  @ApiProperty({ type: "object", additionalProperties: true, nullable: true, description: "Exact saved origin; completion is never verification" }) origin!: Record<string, unknown> | null;
}
export class PlannerPreferencesResponseDto {
  @ApiProperty() useWeekends!: boolean;
  @ApiProperty({ minimum: 30, maximum: 480, multipleOf: 30 }) dailyCapacityMinutes!: number;
  @ApiProperty({ minimum: 1, maximum: 16 }) maxTasksPerDay!: number;
  @ApiProperty({ minimum: 1, maximum: 12 }) horizonWeeks!: number;
  @ApiProperty({ type: String, nullable: true }) timeZone!: string | null;
}
export class PlannerRangeDto {
  @ApiProperty({ description: "First eligible local calendar date" }) start!: string;
  @ApiProperty({ description: "Exclusive end of the selected horizon" }) end!: string;
}
export class PlannerRemainingDto {
  @ApiProperty({ format: "uuid" }) taskId!: string;
  @ApiProperty({ enum: ["duration_exceeds_daily_capacity", "no_contiguous_slot", "horizon_capacity_exhausted"] }) reason!: "duration_exceeds_daily_capacity" | "no_contiguous_slot" | "horizon_capacity_exhausted";
}
export class PlannerPlanningResultDto {
  @ApiProperty({ enum: ["planner-balanced-v2"] }) policyVersion!: "planner-balanced-v2";
  @ApiProperty({ type: PlannerRangeDto }) range!: PlannerRangeDto;
  @ApiProperty({ minimum: 0 }) scheduledCount!: number;
  @ApiProperty({ type: [PlannerRemainingDto] }) remaining!: PlannerRemainingDto[];
  @ApiProperty({ type: [String] }) overloadedDays!: string[];
}
export class PlannerSourceResponseDto {
  @ApiProperty({ enum: ["website", "social", "consistency"] }) channel!: "website" | "social" | "consistency";
  @ApiProperty({ enum: ["available", "empty", "pending", "unavailable", "failed"] }) availability!: "available" | "empty" | "pending" | "unavailable" | "failed";
  @ApiProperty({ type: [String] }) reportIds!: string[];
}
export class PlannerResponseDto {
  @ApiProperty() businessId!: string;
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ type: PlannerPreferencesResponseDto }) preferences!: PlannerPreferencesResponseDto;
  @ApiProperty({ type: [PlannerTaskResponseDto] }) tasks!: PlannerTaskResponseDto[];
  @ApiProperty({ type: [PlannerSourceResponseDto] }) sources!: PlannerSourceResponseDto[];
  @ApiPropertyOptional({ type: PlannerPlanningResultDto }) planning?: PlannerPlanningResultDto;
}
