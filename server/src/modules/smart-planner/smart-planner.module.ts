import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { SMART_PLANNER_REPOSITORY } from "../../persistence/repositories.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { AssessmentCoreModule } from "../assessments/assessment-core.module.js";
import { PlannerController } from "./planner.controller.js";
import { SQLitePlannerRepository } from "./planner.repository.js";
import { PlannerService } from "./planner.service.js";
import { PlannerSourcesService } from "./planner-sources.js";
import { AiModule } from "../ai/ai.module.js";
import { PlannerAiController, PlannerAiFrontendController } from "./planner-ai.controller.js";
import { PlannerAiStore } from "./planner-ai.store.js";
import { PlannerAiService } from "./planner-ai.service.js";
import { PlannerAiGateway } from "./planner-ai.gateway.js";
import { WordPressModule } from "../wordpress/wordpress.module.js";

@Module({
  imports: [PersistenceModule, ReportsModule, AssessmentCoreModule, AiModule, WordPressModule],
  controllers: [PlannerController, PlannerAiController, PlannerAiFrontendController],
  providers: [SQLitePlannerRepository, { provide: SMART_PLANNER_REPOSITORY, useExisting: SQLitePlannerRepository }, PlannerSourcesService, PlannerService, PlannerAiStore, PlannerAiService, PlannerAiGateway],
})
export class SmartPlannerModule {}
