import "reflect-metadata";
/* global AbortController */
import process from "node:process";
import console from "node:console";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { ConfigService } from "@nestjs/config";
import { validateEnvironment } from "../dist/config/environment.js";
import { FacebookGraph } from "../dist/modules/facebook/facebook.service.js";
import { collectFacebookReport } from "../dist/integrations/facebook/collect.js";
import { FileReportStore } from "../dist/reports/file-report.store.js";

// Explicit local operator selection: this does not establish customer ownership.
async function main() {
  const { values } = parseArgs({
    options: {
      "business-id": { type: "string" },
      "business-name": { type: "string" },
      website: { type: "string" },
      "page-id": { type: "string" },
    },
  });
  if (
    !values["business-id"] ||
    !values["business-name"] ||
    !values.website ||
    !/^\d+$/.test(values["page-id"] ?? "")
  )
    throw new Error("ARGUMENTS_REQUIRED");
  const website = new URL(values.website);
  if (
    !["http:", "https:"].includes(website.protocol) ||
    website.username ||
    website.password
  )
    throw new Error("INVALID_WEBSITE");
  process.loadEnvFile(new URL("../.env", import.meta.url));
  const config = new ConfigService(validateEnvironment(process.env));
  const token = config.getOrThrow("FACEBOOK_ACCESS_TOKEN");
  if (!token) throw new Error("FACEBOOK_TOKEN_REQUIRED");
  const now = new Date().toISOString();
  const business = {
    id: values["business-id"],
    name: values["business-name"],
    website: website.toString(),
    createdAt: now,
  };
  const audit = {
    id: randomUUID(),
    businessId: business.id,
    scope: "facebook",
    mode: "live",
    status: "running",
    stage: "collecting_evidence",
    createdAt: now,
    startedAt: now,
    completedAt: null,
    warnings: [],
    failure: null,
    scoringVersion: "facebook-v1",
    results: null,
  };
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const collected = await collectFacebookReport(
      new FacebookGraph(config),
      token,
      values["page-id"],
      audit.id,
      abort.signal,
    );
    audit.results = collected.results;
    audit.warnings = collected.warnings;
    audit.status = collected.partial ? "partial" : "completed";
    audit.stage = "complete";
  } catch (error) {
    audit.status = "failed";
    audit.stage = "failed";
    audit.failure = {
      code: abort.signal.aborted
        ? "INTERRUPTED"
        : typeof error.code === "string"
          ? error.code
          : "FACEBOOK_COLLECTION_FAILED",
      message:
        "Facebook collection could not be completed. Check token and Page authorization.",
    };
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  audit.completedAt = new Date().toISOString();
  const store = new FileReportStore(config);
  const reference = await store.write(audit, business);
  const saved = await store.read(audit.id);
  if (!saved) throw new Error("REPORT_READ_FAILED");
  console.log(
    JSON.stringify(
      {
        ...reference,
        status: audit.status,
        pageId: values["page-id"],
        evidenceCount: saved.results?.evidence.length ?? 0,
        findings: saved.results?.findings.map((f) => f.title) ?? [],
        warnings: audit.warnings,
        failure: audit.failure,
      },
      null,
      2,
    ),
  );
  if (audit.status === "failed") process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Facebook audit could not be saved or configured. Supply --business-id, --business-name, --website and --page-id; check server configuration and archive access.",
  );
  process.exitCode = 1;
});
