import { Module } from "@nestjs/common";
import { AUDIT_REPOSITORY, BUSINESS_REPOSITORY } from "./repositories.js";
import { AppDatabaseModule } from "./sqlite/app-database.module.js";
import { SQLiteAuditRepository, SQLiteBusinessRepository } from "./sqlite/sqlite.repositories.js";

@Module({
  imports: [AppDatabaseModule],
  providers: [
    SQLiteBusinessRepository,
    SQLiteAuditRepository,
    { provide: BUSINESS_REPOSITORY, useExisting: SQLiteBusinessRepository },
    { provide: AUDIT_REPOSITORY, useExisting: SQLiteAuditRepository },
  ],
  exports: [BUSINESS_REPOSITORY, AUDIT_REPOSITORY, SQLiteBusinessRepository, SQLiteAuditRepository, AppDatabaseModule],
})
export class PersistenceModule {}
