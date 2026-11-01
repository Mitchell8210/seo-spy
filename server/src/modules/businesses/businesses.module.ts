import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { BusinessesController } from "./businesses.controller.js";
import { BusinessesService } from "./businesses.service.js";
import { AssessmentCoreModule } from "../assessments/assessment-core.module.js";

@Module({
  imports: [PersistenceModule, AssessmentCoreModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
