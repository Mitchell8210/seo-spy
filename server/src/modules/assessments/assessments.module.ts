import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { WordPressModule } from "../wordpress/wordpress.module.js";
import { AssessmentMuseAdapter } from "../../integrations/assessment-ai/assessment-muse.js";
import { AssessmentCoreModule } from "./assessment-core.module.js";
import { AssessmentAnalysisService } from "./assessment-analysis.service.js";
import { AssessmentEditingService } from "./assessment-editing.service.js";
import { AssessmentsController, AssessmentEditingController } from "./assessments.controller.js";

@Module({ imports: [AssessmentCoreModule, AiModule, WordPressModule], providers: [AssessmentMuseAdapter, AssessmentAnalysisService, AssessmentEditingService], controllers: [AssessmentsController, AssessmentEditingController] })
export class AssessmentsModule {}
