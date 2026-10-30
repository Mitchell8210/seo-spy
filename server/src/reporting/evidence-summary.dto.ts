import { ApiProperty } from "@nestjs/swagger";
import type { EvidenceSummaries, EvidenceSummaryItem } from "./evidence-summary.js";

export class EvidenceSummaryItemDto implements EvidenceSummaryItem {
  @ApiProperty() id!: string;
  @ApiProperty({ type: [String] }) evidenceIds!: string[];
  @ApiProperty({ maxLength: 280 }) text!: string;
  @ApiProperty() sourceLabel!: string;
}

export class EvidenceSummariesDto implements EvidenceSummaries {
  @ApiProperty({ enum: ["programmatic-evidence-v1"] }) version!: "programmatic-evidence-v1";
  @ApiProperty({ format: "uuid" }) auditId!: string;
  @ApiProperty({ type: [EvidenceSummaryItemDto] }) findings!: EvidenceSummaryItemDto[];
  @ApiProperty({ type: [EvidenceSummaryItemDto] }) checks!: EvidenceSummaryItemDto[];
}
