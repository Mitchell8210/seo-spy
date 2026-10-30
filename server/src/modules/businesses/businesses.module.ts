import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { BusinessesController } from "./businesses.controller.js";
import { BusinessesService } from "./businesses.service.js";

@Module({
  imports: [PersistenceModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
