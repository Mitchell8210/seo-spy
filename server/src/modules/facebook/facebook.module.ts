import { Module } from "@nestjs/common";
import { FacebookController } from "./facebook.controller.js";
import { FacebookGraph, FacebookService } from "./facebook.service.js";
import { FacebookCredentialsStore } from "./facebook-credentials.store.js";
import { FacebookReportsService } from "./facebook-reports.service.js";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { AssessmentCoreModule } from "../assessments/assessment-core.module.js";

@Module({
  imports: [PersistenceModule, ReportsModule, AssessmentCoreModule],
  controllers: [FacebookController],
  providers: [
    FacebookGraph,
    FacebookService,
    FacebookCredentialsStore,
    FacebookReportsService,
  ],
})
export class FacebookModule {}
