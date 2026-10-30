import { ApiProperty } from "@nestjs/swagger";
import type { ReportFileReference } from "./report.types.js";

export class ReportFileReferenceDto implements ReportFileReference {
  @ApiProperty({
    format: "uuid",
    description: "Stable report ID; matches the audit ID.",
  })
  reportId!: string;
  @ApiProperty({ format: "uuid" }) auditId!: string;
  @ApiProperty({
    format: "date-time",
    description:
      "UTC archive generation timestamp, independent of page collection time.",
  })
  generatedAt!: string;
  @ApiProperty({
    example:
      "2026-10-28T19-00-00-123Z_00000000-0000-4000-8000-000000000000.json",
  })
  fileName!: string;
  @ApiProperty({
    example: "/api/audits/00000000-0000-4000-8000-000000000000/report",
  })
  downloadUrl!: string;
}
