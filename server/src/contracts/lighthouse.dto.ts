import { ApiProperty } from "@nestjs/swagger";
import type { Audit } from "./domain.js";
import {
  LIGHTHOUSE_CATEGORIES,
  type LighthouseCategory,
  type LighthouseCheck,
  type LighthouseMetric,
  type LighthouseReport,
} from "../integrations/lighthouse/types.js";

class LighthouseCategoryDto implements LighthouseCategory {
  @ApiProperty({ enum: [...LIGHTHOUSE_CATEGORIES] })
  id!: LighthouseCategory["id"];
  @ApiProperty() title!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 100,
    description:
      "Google Lighthouse category score scaled to 0-100. Null when unavailable.",
  })
  score!: number | null;
  @ApiProperty({ enum: ["measured", "unavailable"] })
  availability!: LighthouseCategory["availability"];
  @ApiProperty({ type: [String] }) auditIds!: string[];
}

class LighthouseMetricDto implements LighthouseMetric {
  @ApiProperty({ example: "largest-contentful-paint" }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Lab measurement, not real-user field data.",
  })
  value!: number | null;
  @ApiProperty({ enum: ["ms", "unitless"] }) unit!: LighthouseMetric["unit"];
  @ApiProperty({ type: String, nullable: true }) displayValue!: string | null;
}

class LighthouseCheckDto implements LighthouseCheck {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({
    description:
      "Untrusted provider text; may contain Markdown. Do not render as raw HTML.",
  })
  description!: string;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 1 })
  score!: number | null;
  @ApiProperty({
    example: "binary",
    description:
      "Preserves numeric, binary, manual, informational, notApplicable, and error outcomes.",
  })
  scoreDisplayMode!: string;
  @ApiProperty({ type: String, nullable: true }) displayValue!: string | null;
  @ApiProperty({ type: String, nullable: true }) explanation!: string | null;
}

export class LighthouseReportDto implements LighthouseReport {
  @ApiProperty({ enum: ["google-pagespeed-insights"] })
  provider!: "google-pagespeed-insights";
  @ApiProperty({ enum: ["mobile", "desktop"] })
  strategy!: LighthouseReport["strategy"];
  @ApiProperty({ format: "uri" }) requestedUrl!: string;
  @ApiProperty({ format: "uri" }) finalUrl!: string;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty({
    example: "13.0.0",
    description:
      "Actual provider-reported engine version, not a fixed application version.",
  })
  lighthouseVersion!: string;
  @ApiProperty({ type: [LighthouseCategoryDto] })
  categories!: LighthouseCategoryDto[];
  @ApiProperty({ type: [LighthouseMetricDto] }) metrics!: LighthouseMetricDto[];
  @ApiProperty({ type: [LighthouseCheckDto] }) checks!: LighthouseCheckDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}

class LighthouseFailureDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
}

export class LighthouseResponseDto {
  @ApiProperty({ enum: ["demo", "live"] }) mode!: Audit["mode"];
  @ApiProperty({ format: "uuid" }) auditId!: string;
  @ApiProperty({
    enum: ["queued", "running", "completed", "partial", "failed"],
  })
  status!: Audit["status"];
  @ApiProperty({ type: () => LighthouseReportDto, nullable: true })
  report!: LighthouseReportDto | null;
  @ApiProperty({ type: () => LighthouseFailureDto, nullable: true })
  failure!: LighthouseFailureDto | null;
  @ApiProperty({ type: [String] }) warnings!: string[];
}
