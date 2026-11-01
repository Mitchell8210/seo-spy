/** Fixed-path Rank Math evidence adapter. Provider scores never become SEO Spy scores. */
import { readRankMathTool, toolInput, logRankMathOutcome, type DiagnosticRead, type RankMathDiagnostic, type RankMathStatus } from "./rankmath-execution.js";
export type RankMathRead = DiagnosticRead;
type Availability = "available" | "partial" | "unavailable";
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum = 4000): string | null => typeof value === "string" ? value.slice(0, maximum) : null;
const score = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const root = "/wp-abilities/v1/abilities/rank-math/";
const definitions = ["get-post-seo-meta", "get-seo-scores", "audit-site-seo"] as const;
type AbilityName = typeof definitions[number];

export interface RankMathEvidence {
  provider: "rank-math";
  version: "rank-math-evidence-v1";
  collectedAt: string;
  availability: Availability;
  plugin: { availability: Availability; edition: "free" | "pro-addon" | "unknown"; versions: { plugin: string; version: string | null; active: boolean }[] };
  abilities: { name: AbilityName; available: boolean; readonly: boolean }[];
  content: { availability: Availability; contentId: number | null; source: "ability" | "registered-meta" | null; metadata: Record<string, string | string[]>; storedSeoScore: number | null };
  scores: { availability: Availability; items: { contentId: number; title: string | null; focusKeyword: string | null; storedSeoScore: number | null; grade: string | null; contentModifiedAt: string | null }[] };
  siteAudit: { availability: "unavailable"; canRequest: boolean; reason: string };
  limitations: string[];
}

async function safeRead(read: RankMathRead, path: string): Promise<unknown> {
  try { return await read(path, "GET"); } catch { return null; }
}
async function definition(read: RankMathRead, name: AbilityName) {
  const value = await safeRead(read, `${root}${name}`);
  const available = object(value) && value.name === `rank-math/${name}` && !value.code && !value.error;
  const metadata = available && object(value.meta) ? value.meta : null;
  const annotations = metadata && object(metadata.annotations) ? metadata.annotations : null;
  return { name, available: Boolean(available), readonly: annotations?.readonly === true };
}
function inputQuery(input: Record<string, string | number | boolean>) {
  // Core reads parsed query parameters directly; a JSON string is not an object.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) query.set(`input[${key}]`, String(value));
  return `?${query.toString()}`;
}
function dateFromSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function metadata(source: RecordValue, prefix = "") {
  const result: Record<string, string | string[]> = {};
  for (const key of ["title", "description", "focus_keyword", "canonical", "robots", "facebook_title", "facebook_description", "twitter_title", "twitter_description", "og_title", "og_description"]) {
    const value = source[`${prefix}${prefix && key === "canonical" ? "canonical_url" : key}`];
    if (typeof value === "string") result[key] = value.slice(0, 4000);
    else if (key === "robots" && Array.isArray(value) && value.every(entry => typeof entry === "string")) result[key] = value.slice(0, 20).map(entry => entry.slice(0, 100));
  }
  return result;
}

export async function collectRankMathEvidence(read: RankMathRead, options: { contentType: "pages" | "posts"; contentId?: number; limit?: number }): Promise<RankMathEvidence> {
  if (!["pages", "posts"].includes(options.contentType) || options.contentId !== undefined && !positiveId(options.contentId) || options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)) throw new Error("Invalid Rank Math evidence target.");
  const result: RankMathEvidence = {
    provider: "rank-math", version: "rank-math-evidence-v1", collectedAt: new Date().toISOString(), availability: "unavailable",
    plugin: { availability: "unavailable", edition: "unknown", versions: [] }, abilities: [],
    content: { availability: "unavailable", contentId: options.contentId ?? null, source: null, metadata: {}, storedSeoScore: null },
    scores: { availability: "unavailable", items: [] },
    siteAudit: { availability: "unavailable", canRequest: false, reason: "A site audit is not run while reading evidence. Request it explicitly through the gated audit operation." },
    limitations: ["Stored per-content optimization scores are not fresh SEO audits, search rankings, Lighthouse measurements or an SEO Spy combined score.", "Collection time is not the time Rank Math originally calculated a stored score. Plugin installation does not prove subscription tier."] };
  const plugins = await safeRead(read, "/wp/v2/plugins?context=edit");
  if (Array.isArray(plugins)) {
    result.plugin.availability = "available";
    for (const entry of plugins) {
      if (!object(entry) || typeof entry.plugin !== "string" || !/^seo-by-rank-math(?:-pro)?\//.test(entry.plugin)) continue;
      result.plugin.versions.push({ plugin: entry.plugin.slice(0, 200), version: text(entry.version, 100), active: entry.status === "active" || entry.status === "network-active" });
    }
    const active = result.plugin.versions.filter(entry => entry.active);
    if (active.some(entry => entry.plugin.startsWith("seo-by-rank-math-pro/"))) result.plugin.edition = "pro-addon";
    else if (active.some(entry => entry.plugin.startsWith("seo-by-rank-math/"))) result.plugin.edition = "free";
  } else result.limitations.push("Plugin inventory could not be read; edition/version cannot be established.");
  // Share the adapter's bounded transport; three simultaneous definitions would
  // exceed its two-request limit and falsely report an ability as unavailable.
  for (const name of definitions) result.abilities.push(await definition(read, name));
  const supported = (name: AbilityName) => result.abilities.some(entry => entry.name === name && entry.available && entry.readonly);
  result.siteAudit.canRequest = supported("audit-site-seo");
  if (options.contentId) {
    if (supported("get-post-seo-meta")) {
      const value = await safeRead(read, `${root}get-post-seo-meta/run${inputQuery({ post_id: options.contentId })}`);
      if (object(value) && !value.error && !value.code && value.post_id === options.contentId) {
        // Rank Math's metadata helper casts absent stored scores to integer zero.
        // Its dedicated score-list helper preserves null, so corroborate zero there.
        result.content = { availability: "available", contentId: options.contentId, source: "ability", metadata: metadata(value), storedSeoScore: value.seo_score === 0 ? null : score(value.seo_score) };
      }
    }
    if (result.content.availability === "unavailable") {
      const value = await safeRead(read, `/wp/v2/${options.contentType}/${options.contentId}?context=edit&_fields=id,meta`);
      if (object(value) && value.id === options.contentId && object(value.meta)) {
        const values = metadata(value.meta, "rank_math_");
        const rawScore = value.meta.rank_math_seo_score;
        const storedScore = typeof rawScore === "string" && /^\d+(?:\.\d+)?$/.test(rawScore) ? score(Number(rawScore)) : score(rawScore);
        if (Object.keys(values).length || storedScore !== null) result.content = { availability: "available", contentId: options.contentId, source: "registered-meta", metadata: values, storedSeoScore: storedScore };
      }
      result.limitations.push("Only explicitly exposed Rank Math metadata can be read through core REST; absent fields do not prove missing SEO configuration.");
    }
  }
  if (supported("get-seo-scores")) {
    const values = await safeRead(read, `${root}get-seo-scores/run${inputQuery({ number_of_posts: options.limit ?? 10, post_type: options.contentType === "pages" ? "page" : "post" })}`);
    if (Array.isArray(values) && values.length <= (options.limit ?? 10) && values.every(value => object(value) && positiveId(value.post_id))) {
      result.scores = { availability: "available", items: values.map(value => ({ contentId: value.post_id as number, title: text(value.title), focusKeyword: text(value.keyword), storedSeoScore: score(value.score), grade: text(value.grade, 40), contentModifiedAt: dateFromSeconds(value.last_updated) })) };
      const selected = result.scores.items.find(item => item.contentId === options.contentId);
      if (selected && result.content.source === "ability") result.content.storedSeoScore = selected.storedSeoScore;
      result.limitations.push("Score results are a bounded content sample; content modification times are not score calculation timestamps.");
    }
  }
  if (result.content.source === "ability" && result.content.storedSeoScore === null) result.limitations.push("Metadata-only zero scores are ambiguous because Rank Math casts an absent stored value to zero; an explicit score-list result is required to establish a stored zero.");
  if (result.content.availability === "available" || result.scores.availability === "available") result.availability = result.content.availability === "available" && result.scores.availability === "available" ? "available" : "partial";
  else result.limitations.push("No compatible readable Rank Math result was available; no score or audit findings were invented.");
  return result;
}

export interface RankMathAuditResult {
  provider: "rank-math";
  version: "rank-math-audit-v2";
  status: RankMathStatus;
  diagnostics: RankMathDiagnostic[];
  collectedAt: string;
  availability: Availability;
  score: number | null;
  sourceLastRunAt: string | null;
  remoteApiStatus: "ok" | "unavailable" | "skipped" | "unknown";
  findings: { testId: string; category: string | null; status: "ok" | "fail" | "warning" | "info"; title: string | null; description: string | null; fixText: string | null }[];
  limitations: string[];
}

/** Caller MUST require an explicit approved operation. Despite its GET/readonly annotation,
 * this ability can contact Rank Math's service and replace the site's cached audit options. */
async function collectAuditResult(read: RankMathRead): Promise<RankMathAuditResult> {
  const result: RankMathAuditResult = { provider: "rank-math", version: "rank-math-audit-v2", status: "unknown", diagnostics: [], collectedAt: new Date().toISOString(), availability: "unavailable", score: null, sourceLastRunAt: null, remoteApiStatus: "unknown", findings: [], limitations: ["This is Rank Math's own audit, not Lighthouse or an SEO Spy combined score.", "Running this operation may contact Rank Math's remote service and update cached analysis on WordPress.", "A timeout or unknown result does not establish remote completion; never automatically retry."] };
  const discovery = await readRankMathTool(read, "audit-site-seo", "discovery");
  result.diagnostics.push(discovery.diagnostic);
  result.status = discovery.status;
  if (discovery.status !== "success") return result;
  const ability = discovery.value;
  if (!object(ability) || ability.name !== "rank-math/audit-site-seo" || !object(ability.meta) || !object(ability.meta.annotations) || ability.meta.annotations.readonly !== true) { result.status = "unsupported"; result.limitations.push("The expected Rank Math audit ability is unavailable or its contract changed."); return result; }
  const execution = await readRankMathTool(read, "audit-site-seo", "execution", toolInput({ refresh: true }));
  result.diagnostics.push(execution.diagnostic);
  result.status = execution.status;
  const value = execution.value;
  // Preserve validated partial findings alongside an explicit provider failure.
  if (execution.status !== "success" && !object(value)) return result;
  if (!object(value) || !Array.isArray(value.findings) || value.findings.length > 500) {
    if (execution.status === "success") result.status = "unknown";
    execution.diagnostic.parsingFailure ??= "audit_findings_schema_mismatch";
    result.limitations.push("The audit did not return a compatible result."); return result;
  }
  if (value.findings.some(entry => !object(entry) || typeof entry.test_id !== "string" || !["ok", "fail", "warning", "info"].includes(String(entry.status)))) { if (execution.status === "success") result.status = "unknown"; execution.diagnostic.parsingFailure = "audit_finding_schema_mismatch"; result.limitations.push("Audit findings failed validation."); return result; }
  result.findings = value.findings.map(entry => ({ testId: entry.test_id.slice(0, 200), category: text(entry.category, 100), status: entry.status as "ok" | "fail" | "warning" | "info", title: text(entry.title), description: text(entry.description), fixText: text(entry.fix_text) }));
  result.sourceLastRunAt = dateFromSeconds(value.last_run_at);
  result.remoteApiStatus = ["ok", "unavailable", "skipped"].includes(String(value.remote_api_status)) ? value.remote_api_status as "ok" | "unavailable" | "skipped" : "unknown";
  if (result.findings.length) {
    result.score = score(value.score);
    result.availability = value.error || result.remoteApiStatus !== "ok" || result.score === null ? "partial" : "available";
  }
  if (execution.status === "success") result.status = value.error || result.remoteApiStatus === "unavailable" ? "failed" : result.availability === "available" ? "success" : "unknown";
  if (value.error) result.limitations.push("Rank Math reported an audit error; returned findings may have incomplete coverage.");
  if (!result.findings.length) result.limitations.push("No audit checks were established; an empty result is not a clean audit.");
  return result;
}

export async function runRankMathAudit(read: RankMathRead): Promise<RankMathAuditResult> {
  const result = await collectAuditResult(read);
  logRankMathOutcome("audit-site-seo", result.status, result.diagnostics);
  return result;
}

/** Read-time overlay only: preserve immutable old receipts without inventing lost diagnostics. */
export function rankMathOutcomeStatus(stored: unknown): unknown {
  if (!object(stored)) return stored;
  const result = object(stored.result) ? stored.result : null;
  const states = ["success", "failed", "timeout", "unsupported", "unknown"];
  const status = result && states.includes(String(result.status)) ? result.status : states.includes(String(stored.status)) ? stored.status : "unknown";
  return { ...stored, status, ...(result ? { result: { ...result, status } } : {}) };
}
