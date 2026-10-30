import type {
  LighthouseReport,
  LighthouseStrategy,
} from "../integrations/lighthouse/types.js";
import type { ReportFileReference } from "../reports/report.types.js";
import type { FacebookReport } from "../integrations/facebook/types.js";
import type { EvidenceSummaries } from "../reporting/evidence-summary.js";
import type { WebsiteAnalysis } from "../integrations/lighthouse/prioritize.js";

export type AuditStatus =
  "queued" | "running" | "completed" | "partial" | "failed";
export type AuditStage =
  | "queued"
  | "collecting_evidence"
  | "evaluating_checks"
  | "running_lighthouse"
  | "preparing_recommendations"
  | "complete"
  | "failed";
export type Severity = "critical" | "medium" | "low";
export type FindingSource = "website" | "website_and_facebook" | "facebook";

export interface Business {
  id: string;
  name: string;
  website: string;
  createdAt: string;
}

export interface Connection {
  id: string;
  businessId: string;
  platform: "website" | "facebook";
  identity: string;
  status:
    | "connected"
    | "disconnected"
    | "authorization_required"
    | "checking"
    | "error";
  mode: "demo" | "live";
}

export interface Evidence {
  id: string;
  auditId: string;
  checkId: string;
  sourceUrl: string;
  collectedAt: string;
  observed: Record<string, string>;
  mode: "demo" | "live";
}

export interface Finding {
  id: string;
  auditId: string;
  checkId: string;
  evidenceIds: string[];
  severity: Severity;
  source: FindingSource;
  title: string;
  explanation: string;
  status: "needs_review";
}

export interface Recommendation {
  id: string;
  auditId: string;
  findingId: string;
  title: string;
  explanation: string;
  recommendedChange: string;
  purpose: string;
  status: "needs_review";
}

export interface Score {
  category: "website" | "social" | "consistency" | "overall";
  value: number | null;
  maximum: number;
  availability: "demo" | "unavailable";
  scoringVersion: "demo-v1" | "homepage-v1" | "facebook-v1";
}

export interface AuditResults {
  websiteAnalysis?: WebsiteAnalysis;
  evidenceSummaries?: EvidenceSummaries;
  evidence: Evidence[];
  findings: Finding[];
  recommendations: Recommendation[];
  scores: Score[];
  lighthouse?: LighthouseReport;
  facebook?: FacebookReport;
}

export interface Audit {
  report?: ReportFileReference;
  id: string;
  businessId: string;
  scope: "demo" | "homepage" | "lighthouse" | "facebook";
  strategy?: LighthouseStrategy;
  mode: "demo" | "live";
  status: AuditStatus;
  stage: AuditStage;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  warnings: string[];
  failure: { code: string; message: string } | null;
  scoringVersion: "demo-v1" | "homepage-v1" | "lighthouse-v1" | "facebook-v1";
  results: AuditResults | null;
}
