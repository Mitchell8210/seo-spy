import type { Audit, AuditResults, Business } from "../contracts/domain.js";

export interface ReportFileReference {
  reportId: string;
  auditId: string;
  generatedAt: string;
  fileName: string;
  downloadUrl: string;
}

export interface StoredReportSummary extends ReportFileReference {
  businessId: string;
  scope: Audit["scope"];
  mode: Audit["mode"];
  status: Audit["status"];
  counts: { findings: number; recommendations: number };
}

export interface AuditReportRecord {
  schemaVersion: "seo-spy.audit-report.v1";
  reportId: string;
  auditId: string;
  generatedAt: string;
  business: Business;
  audit: Omit<Audit, "results" | "report">;
  results: AuditResults | null;
}

export class ReportStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReportStorageError";
  }
}
