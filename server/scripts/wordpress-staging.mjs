// Explicit local-operator media pilot workflow. No dotenv loading, writes gate changes,
// automatic retries, rollback, fresh audits or proposal creation during Apply.
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = value => typeof value === "object" && value !== null && !Array.isArray(value);
class WorkflowError extends Error {}
const fail = message => { throw new WorkflowError(message); };

async function readAltText(path) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8000) fail("The selected alt-text file exceeds the bounded UTF-8 input limit.");
    const buffer = Buffer.alloc(8001);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 8000) fail("The selected alt-text file exceeds the bounded UTF-8 input limit.");
    return new globalThis.TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used));
  } finally { await handle.close(); }
}

function options(argv) {
  const result = {};
  const allowed = new Set(["api-origin", "business-id", "site-url", "mode", "resource-id", "alt-text-file", "proposal-id", "proposal-hash", "confirmed", "target-confirmed"]);
  for (const argument of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argument);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(result, match[1])) fail("Use documented, unique --name=value options only.");
    const [, key, value] = match;
    if (["confirmed", "target-confirmed"].includes(key)) {
      if (value !== undefined) fail("Confirmation options must be explicit flags without values.");
      result[key] = true;
    } else {
      if (!value) fail("A required option value is missing.");
      result[key] = value;
    }
  }
  if (!result["target-confirmed"]) fail("Confirm the explicitly selected installation with --target-confirmed before using this workflow.");
  if (!["preview", "apply", "inspect"].includes(result.mode)) fail("Choose --mode=preview, --mode=apply or --mode=inspect.");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(result["business-id"] ?? "")) fail("A registered --business-id is required.");
  let api;
  let site;
  try { api = new URL(result["api-origin"] ?? "http://127.0.0.1:3001"); site = new URL(result["site-url"]); }
  catch { fail("Provide a loopback API origin and an explicit HTTPS site origin."); }
  if (api.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(api.hostname) || api.username || api.password || api.pathname !== "/" || api.search || api.hash) fail("The API origin must be plain HTTP on loopback, without credentials or a path.");
  if (site.protocol !== "https:" || site.username || site.password || site.port || site.pathname !== "/" || site.search || site.hash) fail("The selected site must be an HTTPS root origin without credentials or custom ports.");
  result.api = api.origin;
  result.site = site.origin;
  if (result.mode === "preview") {
    if (!/^[1-9][0-9]*$/.test(result["resource-id"] ?? "") || !Number.isSafeInteger(Number(result["resource-id"])) || !result["alt-text-file"]) fail("Preview requires a positive --resource-id and --alt-text-file.");
    if (result["proposal-id"] || result["proposal-hash"] || result.confirmed) fail("Preview cannot include Apply options.");
  } else {
    if (!uuid.test(result["proposal-id"] ?? "")) fail("An existing UUID-v4 --proposal-id is required.");
    if (result["resource-id"] || result["alt-text-file"]) fail("Apply and inspect use the saved proposal, not a new patch.");
    if (result.mode === "apply" && (!result.confirmed || !/^[a-f0-9]{64}$/.test(result["proposal-hash"] ?? ""))) fail("Apply requires --confirmed and the exact reviewed --proposal-hash.");
  }
  return result;
}

async function readJson(response) {
  const maximum = 256 * 1024;
  if (!response.body) fail("The local API returned no response body.");
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail("The local API response exceeded the workflow limit."); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { fail("The local API returned an unreadable or oversized response."); }
  finally { reader.releaseLock(); }
}

function review(proposal, config) {
  if (!object(proposal) || proposal.version !== "wordpress-proposal-v1" || !uuid.test(proposal.id ?? "") || proposal.businessId !== config["business-id"] || typeof proposal.siteUrl !== "string" || proposal.siteUrl.replace(/\/$/, "") !== config.site || proposal.resource !== "media" || !Number.isSafeInteger(proposal.resourceId) || proposal.resourceId < 1 || !object(proposal.changes) || !object(proposal.before) || Object.keys(proposal.changes).length !== 1 || typeof proposal.changes.altText !== "string" || typeof proposal.before.altText !== "string" || !/^[a-f0-9]{64}$/.test(proposal.hash ?? "") || typeof proposal.modified !== "string" || !Number.isFinite(Date.parse(proposal.expiresAt))) fail("The saved proposal is not a valid media-alt-text proposal for this business and installation.");
  return {
    id: proposal.id, hash: proposal.hash, businessId: proposal.businessId, siteUrl: proposal.siteUrl,
    resource: proposal.resource, resourceId: proposal.resourceId, before: { altText: proposal.before.altText },
    changes: { altText: proposal.changes.altText }, modified: proposal.modified, expiresAt: proposal.expiresAt,
    executionStarted: proposal.executionStarted === true, outcome: proposal.outcome ?? null,
  };
}

export async function runWordPressStaging(argv, dependencies = {}) {
  const config = options(argv);
  const env = dependencies.env ?? process.env;
  const token = env.WORDPRESS_OPERATOR_KEY;
  if (typeof token !== "string" || token.length < 32) fail("Set WORDPRESS_OPERATOR_KEY in this shell; do not pass credentials as command-line options.");
  const fetchApi = dependencies.fetch ?? globalThis.fetch;
  const readText = dependencies.readText ?? readAltText;
  const output = dependencies.output ?? (value => console.log(JSON.stringify(value, null, 2)));
  const now = dependencies.now ?? Date.now;
  const root = `${config.api}/api/wordpress/businesses/${encodeURIComponent(config["business-id"])}`;
  async function api(path, method = "GET", body) {
    let response;
    try {
      response = await fetchApi(`${root}${path}`, {
        method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: globalThis.AbortSignal.timeout(30000),
      });
    } catch { fail("The local API request did not complete. Do not retry an Apply request; inspect the original proposal receipt."); }
    const value = await readJson(response);
    if (!response.ok) {
      const code = object(value) && object(value.error) && /^[A-Z0-9_]{1,80}$/.test(value.error.code ?? "") ? ` ${value.error.code}` : "";
      fail(`The local API rejected the request (HTTP ${response.status}${code}). Inspect the saved proposal; no automatic retry was made.`);
    }
    return value;
  }

  const connection = await api("/connection");
  if (!object(connection) || connection.authenticated !== true || connection.mode !== "local_operator" || connection.businessId !== config["business-id"] || typeof connection.siteUrl !== "string" || connection.siteUrl.replace(/\/$/, "") !== config.site) fail("The API connection does not match the explicitly selected business and installation.");
  if (config.mode === "preview") {
    let altText;
    try { altText = await readText(resolve(config["alt-text-file"])); }
    catch { fail("The selected alt-text file could not be read."); }
    if (typeof altText !== "string" || altText.length > 2000 || altText.includes("\0")) fail("Alt text must contain at most 2000 characters and no NUL character. The file is used exactly, including newlines.");
    const proposal = review(await api("/proposals", "POST", { resource: "media", resourceId: Number(config["resource-id"]), changes: { altText } }), config);
    if (proposal.resourceId !== Number(config["resource-id"]) || proposal.changes.altText !== altText) fail("The proposal did not match the requested exact target and alt text.");
    output({ mode: "preview", proposal, instruction: "Review this exact target, before/after text, hash and expiry. Preview has not applied a change. Empty alternative text may be intentional for decorative images." });
    return { mode: "preview", proposal };
  }

  const proposalPath = `/proposals/${config["proposal-id"]}`;
  const proposal = review(await api(proposalPath), config);
  if (proposal.id !== config["proposal-id"]) fail("The API returned a different proposal ID.");
  if (config.mode === "inspect") { output({ mode: "inspect", proposal }); return { mode: "inspect", proposal }; }
  if (proposal.hash !== config["proposal-hash"]) fail("The supplied hash does not match the exact saved proposal. Nothing was applied.");
  output({ mode: "apply", reviewedProposal: proposal });
  if (proposal.outcome !== null || proposal.executionStarted) {
    output({ mode: "inspect", proposal, instruction: "Execution already started or has a receipt. No Apply request was sent. Inspect/reconcile the original operation; do not create a new proposal to bypass an uncertain outcome." });
    return { mode: "inspect", proposal };
  }
  if (connection.writesEnabled !== true) fail("WordPress writes are disabled. Enable the gate only for the explicitly approved operation, then restore it to false.");
  if (Date.parse(proposal.expiresAt) <= now()) fail("The proposal expired. Create and review a new proposal; the old approval cannot be reused.");
  let outcome;
  try { outcome = await api(`${proposalPath}/apply`, "POST", { proposalHash: proposal.hash, confirmed: true }); }
  catch {
    let inspected = null;
    try { inspected = review(await api(proposalPath), config); } catch { /* Inspection is read-only and never retries Apply. */ }
    output({ mode: "inspect", proposal: inspected, status: "outcome_unknown", instruction: "Apply did not return a reliable result. No retry was sent. Disable writes and reconcile this original proposal and its stored receipt." });
    return { mode: "inspect", proposal: inspected, status: "outcome_unknown" };
  }
  // GET the persisted receipt rather than relying only on the transient response.
  let inspected;
  try { inspected = review(await api(proposalPath), config); }
  catch {
    output({ mode: "inspect", status: "outcome_unknown", instruction: "A write response was received but the saved receipt could not be inspected. Disable writes and inspect the original proposal. No retry was sent." });
    return { mode: "inspect", status: "outcome_unknown" };
  }
  if (!object(outcome) || outcome.id !== proposal.id || outcome.businessId !== proposal.businessId || !["applied", "failed", "outcome_unknown"].includes(outcome.status) || !object(inspected.outcome) || JSON.stringify(outcome) !== JSON.stringify(inspected.outcome)) fail("The Apply response did not match its saved receipt. Disable writes and reconcile the original operation; do not retry.");
  output({ mode: "apply", proposal: inspected, outcome, instruction: "Disable writes after inspection. Stored-field verification does not prove the rendered page changed or SEO improved. Restoration requires a separately reviewed proposal and explicit approval." });
  return { mode: "apply", proposal: inspected, outcome };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runWordPressStaging(process.argv.slice(2));
    const outcomeStatus = result.outcome?.status ?? result.proposal?.outcome?.status;
    if (result.status === "outcome_unknown" || ["outcome_unknown", "failed"].includes(outcomeStatus) || result.proposal?.executionStarted && !result.proposal?.outcome) process.exitCode = 2;
  } catch (error) {
    // Never echo raw provider/transport errors, file contents, tokens or arguments.
    console.error(error instanceof WorkflowError ? error.message : "WordPress media pilot stopped. Check the documented options, exact installation binding, proposal receipt and write gate. No automatic retry or restoration was performed.");
    process.exitCode = 1;
  }
}
