import { ApiProperty } from "@nestjs/swagger";
import { FindingDto, RecommendationDto } from "./responses.dto.js";
import type { PriorityDecision, WebsiteAnalysis } from "../integrations/lighthouse/prioritize.js";

class PriorityDecisionDto implements PriorityDecision {
  @ApiProperty() findingId!: string;
  @ApiProperty() ruleId!: string;
  @ApiProperty({ enum: ["critical", "medium", "low"] }) severity!: PriorityDecision["severity"];
  @ApiProperty() reason!: string;
  @ApiProperty({ type: [String] }) evidenceIds!: string[];
}
export class WebsiteAnalysisDto implements WebsiteAnalysis {
  @ApiProperty({ enum: ["website-priority-v1"] }) version!: "website-priority-v1";
  @ApiProperty({ format: "uuid" }) auditId!: string;
  @ApiProperty({ type: [FindingDto] }) findings!: FindingDto[];
  @ApiProperty({ type: [RecommendationDto] }) recommendations!: RecommendationDto[];
  @ApiProperty({ type: [PriorityDecisionDto] }) priorities!: PriorityDecisionDto[];
}
