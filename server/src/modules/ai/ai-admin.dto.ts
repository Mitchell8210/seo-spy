import { ApiProperty } from "@nestjs/swagger";
import { Equals, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

export class ApproveAiIntentDto {
  @ApiProperty({ enum: [true] }) @Equals(true) confirmed!: true;
  @ApiProperty({ description: "The exact reviewed payload hash, including model, reasoning, schema and bounded evidence." }) @IsString() @Matches(/^[a-f0-9]{64}$/) requestHash!: string;
  @ApiProperty({ minimum: 1, description: "The exact reviewed maximum reservation in USD microdollars. 1 USD = 1000000 micros." }) @IsInt() @Min(1) reserveMicros!: number;
}
export class AuthorizeAiDemoDto {
  @ApiProperty({ enum: [true] }) @Equals(true) confirmed!: true;
  @ApiProperty({ minimum: 1, maximum: 148000000, description: "Separately authorized cumulative demo budget in USD microdollars. This never resets prior demo usage." }) @IsInt() @Min(1) @Max(148000000) budgetMicros!: number;
  @ApiProperty({ minimum: 1, maximum: 148000000 }) @IsInt() @Min(1) @Max(148000000) dailyMicros!: number;
  @ApiProperty({ minimum: 1, maximum: 10000 }) @IsInt() @Min(1) @Max(10000) maxCalls!: number;
  @ApiProperty({ description: "Why final testing/demo usage is being authorized. Authorization does not itself make a call." }) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}
