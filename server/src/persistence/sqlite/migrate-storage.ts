import type { Audit } from "../../contracts/domain.js";
import type { FileReportStore } from "../../reports/file-report.store.js";
import { reportReference } from "../../reports/file-report.store.js";
import type { AuditReportRecord } from "../../reports/report.types.js";
import type { WordPressReportsStore } from "../../modules/wordpress/wordpress-reports.store.js";
import type { WordPressMuseStore } from "../../modules/wordpress/wordpress-muse.store.js";
import type { WordPressActionsStore } from "../../modules/wordpress/wordpress-actions.store.js";
import { AppDatabase, AppDatabaseError } from "./app-database.js";
import type { SQLiteAuditRepository, SQLiteBusinessRepository } from "./sqlite.repositories.js";

export interface ApplicationStorage {
  database: AppDatabase;
  businesses: SQLiteBusinessRepository;
  audits: SQLiteAuditRepository;
  reports: FileReportStore;
  wordpress: WordPressReportsStore;
  muse: WordPressMuseStore;
  actions: WordPressActionsStore;
}

/** Additive, repeatable adoption. Original exports and the AI credit ledger are never changed. */
export async function migrateApplicationStorage(storage: ApplicationStorage) {
  const reports = await storage.reports.importLegacy();
  const wordpress = await storage.wordpress.importLegacy();
  const muse = await storage.muse.importLegacy();
  const actions = await storage.actions.importLegacy();
  let importedAudits = 0, existingAudits = 0, importedBusinesses = 0;
  for (const artifact of storage.database.listArtifacts("audit-report")) {
    const report = artifact.payload as AuditReportRecord;
    if (await storage.businesses.importBusiness(report.business)) importedBusinesses++;
    const existing = await storage.audits.findById(report.auditId);
    if (existing) {
      if (existing.businessId !== report.business.id || existing.scope !== report.audit.scope) throw new AppDatabaseError("DATABASE_IMPORT_CONFLICT", "An archived report conflicts with a registered audit target.");
      // Runtime status may be newer than the historical snapshot. Never replace it during import.
      existingAudits++;
      continue;
    }
    const audit: Audit = { ...report.audit, results: report.results, report: reportReference(report) };
    if (await storage.audits.importAudit(audit)) importedAudits++;
  }
  return { reports, wordpress, muse, actions, importedBusinesses, importedAudits, existingAudits, interruptedAudits: (await storage.audits.listInterruptedAudits()).map(audit => ({ id: audit.id, businessId: audit.businessId, scope: audit.scope, status: audit.status, createdAt: audit.createdAt })) };
}

/** Local operator recovery only, after the original workers are stopped. Never replays work. */
export async function recoverInterruptedAudit(storage: ApplicationStorage, id: string, workersStopped: boolean) {
  if (!workersStopped) throw new AppDatabaseError("DATABASE_RECOVERY_CONFIRMATION_REQUIRED", "Stop the original workers and explicitly confirm before recovering an interrupted audit.");
  const audit = await storage.audits.findById(id);
  if (!audit) throw new AppDatabaseError("AUDIT_NOT_FOUND", "The persisted audit was not found.");
  if (audit.status !== "queued" && audit.status !== "running") return { auditId: id, status: audit.status, recovered: false };
  const archived = await storage.reports.read(id);
  if (archived) {
    if (archived.business.id !== audit.businessId || archived.audit.scope !== audit.scope) throw new AppDatabaseError("DATABASE_IMPORT_CONFLICT", "The terminal snapshot belongs to another audit target.");
    const restored: Audit = { ...archived.audit, results: archived.results, report: reportReference(archived) };
    await storage.audits.save(restored);
    return { auditId: id, status: restored.status, recovered: true, source: "saved_terminal_report" };
  }
  const business = await storage.businesses.findById(audit.businessId);
  if (!business) throw new AppDatabaseError("BUSINESS_NOT_FOUND", "The registered audit business was not found.");
  audit.status = "failed";
  audit.stage = "failed";
  audit.completedAt = new Date().toISOString();
  audit.failure = { code: "SERVER_INTERRUPTED", message: "The original worker stopped before a terminal result was saved. Work was not automatically resumed or retried." };
  audit.warnings.push("A local operator closed this interrupted run after confirming its original workers were stopped. Any already saved partial evidence was preserved.");
  audit.report = await storage.reports.write(audit, business);
  await storage.audits.save(audit);
  return { auditId: id, status: audit.status, recovered: true, source: "operator_closed_interrupted_run" };
}
