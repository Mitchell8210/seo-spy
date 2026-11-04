import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { AiModule } from "../ai/ai.module.js";
import { InvestigationAiService } from "./investigation-ai.service.js";
@Module({ imports: [PersistenceModule, ReportsModule, AiModule], providers: [InvestigationAiService], exports: [InvestigationAiService] })
export class InvestigationAiModule {}
