import { Module } from "@nestjs/common";
import { AUDIT_REPOSITORY, BUSINESS_REPOSITORY } from "./repositories.js";
import { AppDatabaseModule } from "./sqlite/app-database.module.js";
import { SQLiteAuditRepository, SQLiteBusinessRepository } from "./sqlite/sqlite.repositories.js";
import { InvestigationInterpretationStore } from "../reporting/investigation-interpretation.store.js";

@Module({
  imports: [AppDatabaseModule],
  providers: [
    InvestigationInterpretationStore,
    SQLiteBusinessRepository,
    SQLiteAuditRepository,
    { provide: BUSINESS_REPOSITORY, useExisting: SQLiteBusinessRepository },
    { provide: AUDIT_REPOSITORY, useExisting: SQLiteAuditRepository },
  ],
  exports: [BUSINESS_REPOSITORY, AUDIT_REPOSITORY, SQLiteBusinessRepository, SQLiteAuditRepository, AppDatabaseModule, InvestigationInterpretationStore],
})
export class PersistenceModule {}
