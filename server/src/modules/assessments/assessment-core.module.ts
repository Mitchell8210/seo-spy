import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { AssessmentStore } from "./assessment.store.js";
import { AssessmentService } from "./assessment.service.js";

@Module({ imports: [PersistenceModule, ReportsModule], providers: [AssessmentStore, AssessmentService], exports: [AssessmentStore, AssessmentService] })
export class AssessmentCoreModule {}
