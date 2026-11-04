import { createHash } from "node:crypto";
import { estimateMuseCost } from "./muse-cost.js";

// This exact, versioned request is the only scope eligible for the one-time amendment.
// Frozen identifiers retain validation of the consumed, rejected request's audit.
export const MUSE_HELLO_V1_SCOPE = "diagnostic:meta-muse:hello-v1";
export const MUSE_HELLO_V1_HASH = "fbdf7801ffa3e520e07350cb658a6607afd4194b7040ea33e4f1fc571412245e";
export const MUSE_HELLO_SCOPE = "diagnostic:meta-muse:hello-v2";
export const MUSE_HELLO_PAYLOAD = JSON.stringify({ model: "muse-spark-1.3", input: "Hello.", reasoning: { effort: "low" }, max_output_tokens: 128,
  store: false, stream: false, background: false, tools: [], tool_choice: "auto" });
export const MUSE_HELLO_HASH = createHash("sha256").update(MUSE_HELLO_PAYLOAD).digest("hex");
export function prepareMuseHello() {
  const cost = estimateMuseCost(MUSE_HELLO_PAYLOAD, 128);
  if (cost.reserveMicros > 10000) throw new Error("The fixed diagnostic exceeds its approved maximum reservation.");
  return { ...cost, model: "muse-spark-1.3" as const, requestHash: MUSE_HELLO_HASH, scope: MUSE_HELLO_SCOPE, payload: MUSE_HELLO_PAYLOAD };
}

export const MUSE_MINIMAL_HELLO_SCOPE = "diagnostic:meta-muse:hello-minimal-512-v1";
export const MUSE_MINIMAL_HELLO_HASH = "5ab9516832b50448c3c0a7d786945e9fe8409b9dbbd39b24862898569266a6a5";
/** Separate exact request; never change historical Hello payloads or approvals. */
export function prepareMinimalMuseHello() {
  const payload = JSON.stringify({ model: "muse-spark-1.3", input: "Hello.", reasoning: { effort: "minimal" }, max_output_tokens: 512,
    store: false, stream: false, background: false, tools: [], tool_choice: "auto" });
  const cost = estimateMuseCost(payload, 512);
  if (createHash("sha256").update(payload).digest("hex") !== MUSE_MINIMAL_HELLO_HASH || cost.reserveMicros !== 8196) throw new Error("The approved minimal diagnostic request or reservation differs.");
  return { ...cost, model: "muse-spark-1.3" as const, requestHash: MUSE_MINIMAL_HELLO_HASH, scope: MUSE_MINIMAL_HELLO_SCOPE, payload };
}
