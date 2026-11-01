import { WebsiteCollectionModule } from "../../integrations/website/website-collection.module.js";
import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { AuditsController } from "./audits.controller.js";
import { AuditsService } from "./audits.service.js";
import { AuditRunner } from "./audit-runner.service.js";
import {
  PageSpeedService,
  PageSpeedTransport,
} from "../../integrations/lighthouse/pagespeed.service.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { AssessmentCoreModule } from "../assessments/assessment-core.module.js";

@Module({
  imports: [PersistenceModule, ReportsModule, WebsiteCollectionModule, AssessmentCoreModule],
  controllers: [AuditsController],
  providers: [
    AuditsService,
    AuditRunner,
    PageSpeedService,
    PageSpeedTransport,
  ],
  exports: [AuditsService],
})
export class AuditsModule {}
