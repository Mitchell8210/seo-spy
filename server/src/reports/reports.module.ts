import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { FileReportStore } from "./file-report.store.js";
import { ReportsController } from "./reports.controller.js";

@Module({
  imports: [PersistenceModule],
  controllers: [ReportsController],
  providers: [FileReportStore],
  exports: [FileReportStore],
})
export class ReportsModule {}
