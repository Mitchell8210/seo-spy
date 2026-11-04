import { Module } from "@nestjs/common";
import { FacebookController } from "./facebook.controller.js";
import { FacebookGraph, FacebookService } from "./facebook.service.js";
import { FacebookCredentialsStore } from "./facebook-credentials.store.js";
import { FacebookReportsService } from "./facebook-reports.service.js";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { AssessmentCoreModule } from "../assessments/assessment-core.module.js";
import { GoogleReportingModule } from "../google/google.module.js";
import { AuditsModule } from "../audits/audits.module.js";
import { OverallInvestigationService } from "./overall-investigation.service.js";
import { InvestigationAiModule } from "../investigation-ai/investigation-ai.module.js";
import { AiModule } from "../ai/ai.module.js";
import { FacebookPostsController } from "./facebook-posts.controller.js";
import { FacebookPostsService } from "./facebook-posts.service.js";
import { FacebookPostsStore } from "./facebook-posts.store.js";

@Module({
  imports: [PersistenceModule, ReportsModule, AssessmentCoreModule, GoogleReportingModule, AuditsModule, InvestigationAiModule, AiModule],
  exports: [FacebookService, FacebookReportsService, OverallInvestigationService],
  controllers: [FacebookController, FacebookPostsController],
  providers: [
    FacebookPostsService,
    FacebookPostsStore,
    FacebookGraph,
    FacebookService,
    FacebookCredentialsStore,
    FacebookReportsService,
    OverallInvestigationService,
  ],
})
export class FacebookModule {}
