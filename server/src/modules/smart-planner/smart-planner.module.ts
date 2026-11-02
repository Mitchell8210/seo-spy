import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { SMART_PLANNER_REPOSITORY } from "../../persistence/repositories.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { AssessmentCoreModule } from "../assessments/assessment-core.module.js";
import { PlannerController } from "./planner.controller.js";
import { SQLitePlannerRepository } from "./planner.repository.js";
import { PlannerService } from "./planner.service.js";
import { PlannerSourcesService } from "./planner-sources.js";

@Module({
  imports: [PersistenceModule, ReportsModule, AssessmentCoreModule],
  controllers: [PlannerController],
  providers: [SQLitePlannerRepository, { provide: SMART_PLANNER_REPOSITORY, useExisting: SQLitePlannerRepository }, PlannerSourcesService, PlannerService],
})
export class SmartPlannerModule {}
