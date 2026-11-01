import { jest } from "@jest/globals";
import { Logger } from "@nestjs/common";
import { WordPressRequestError } from "../src/integrations/wordpress/wordpress.client.js";
import { analyzeRankMathPost, readRankMathTool } from "../src/integrations/wordpress/rankmath-execution.js";
import { rankMathOutcomeStatus, runRankMathAudit, type RankMathRead } from "../src/integrations/wordpress/rankmath.js";

const definition = { name: "rank-math/audit-site-seo", meta: { annotations: { readonly: true } } };
const findings = [{ test_id: "title", status: "fail", title: "Inspect title" }];
const audit = { findings, score: 60, remote_api_status: "ok", error: null };
const reader = (value: unknown): RankMathRead => async path => path.includes("/run") ? value : definition;

describe("Rank Math execution diagnostics and explicit outcomes", () => {
  let logs: ReturnType<typeof jest.spyOn>;
  beforeEach(() => { logs = jest.spyOn(Logger.prototype, "log").mockImplementation(() => {}); });
  afterEach(() => { logs.mockRestore(); });

  it.each([audit, { structuredContent: audit, isError: false }, { content: [{ type: "text", text: JSON.stringify(audit) }], isError: false }, { jsonrpc: "2.0", result: { structuredContent: audit } }])("accepts documented flat or standard MCP envelopes without losing findings", async value => {
    const result = await runRankMathAudit(reader(value));
    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(1);
    expect(result.score).toBe(60);
    expect(result.version).toBe("rank-math-audit-v2");
  });

  it.each([
    ["WORDPRESS_TIMEOUT", undefined, "timeout"],
    ["WORDPRESS_CONNECTION_TIMEOUT", undefined, "timeout"],
    ["WORDPRESS_ACCESS_DENIED", 403, "failed"],
    ["WORDPRESS_HTTP_ERROR", 400, "failed"],
    ["WORDPRESS_HTTP_ERROR", 404, "unsupported"],
    ["WORDPRESS_HTTP_ERROR", 504, "timeout"],
    ["WORDPRESS_HTTP_ERROR", 500, "unknown"],
    ["WORDPRESS_REQUEST_FAILED", undefined, "unknown"],
    ["WORDPRESS_INVALID_RESPONSE", 200, "unknown"],
  ] as const)("distinguishes %s / %s as %s without retry", async (code, http, status) => {
    const calls: string[] = [];
    const result = await runRankMathAudit(async path => {
      calls.push(path);
      if (path.includes("/run")) throw new WordPressRequestError(code, "SECRET credential and raw remote details", http);
      return definition;
    });
    expect(result.status).toBe(status);
    expect(result.availability).toBe("unavailable");
    expect(calls.filter(p => p.includes("/run"))).toHaveLength(1);
    expect(JSON.stringify([result, logs.mock.calls])).not.toContain("SECRET");
  });

  it("captures structured JSON-RPC and MCP errors without storing messages/data", async () => {
    const jsonrpc = await runRankMathAudit(reader({ jsonrpc: "2.0", error: { code: -32602, message: "SECRET", data: { token: "SECRET" } } }));
    expect(jsonrpc.status).toBe("failed");
    expect(jsonrpc.diagnostics[1]?.providerError?.code).toBe(-32602);
    const mcp = await runRankMathAudit(reader({ isError: true, content: [{ type: "text", text: "SECRET provider message" }] }));
    expect(mcp.status).toBe("failed");
    expect(mcp.diagnostics[1]?.parsingFailure).toBe("mcp_text_invalid_json");
    const structuredText = await runRankMathAudit(reader({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "rest_ability_not_found", message: "SECRET", data: { status: 404 } } }) }] }));
    expect(structuredText.status).toBe("unsupported");
    expect(structuredText.diagnostics[1]?.providerError).toEqual({ code: "rest_ability_not_found", status: 404, isError: true });
    expect(JSON.stringify([jsonrpc, mcp, logs.mock.calls])).not.toContain("SECRET");
  });

  it("marks unexpected response schemas and empty findings unknown", async () => {
    const unexpected = await runRankMathAudit(reader({ analysis: { checks: findings }, secret: "SECRET" }));
    expect(unexpected.status).toBe("unknown");
    expect(unexpected.diagnostics[1]?.parsingFailure).toBe("audit_findings_schema_mismatch");
    expect((await runRankMathAudit(reader({ findings: [], score: 100, remote_api_status: "ok" }))).status).toBe("unknown");
    expect(JSON.stringify(unexpected)).not.toContain("SECRET");
  });

  it.each([[-32601, null, "unsupported"], ["remote_timeout", 504, "timeout"]] as const)("uses structured errors inside HTTP failures: %s", async (code, status, expected) => {
    const failure = new WordPressRequestError("WORDPRESS_HTTP_ERROR", "SECRET", 400);
    failure.diagnostic = { httpStatus: 400, durationMs: 10, responseType: "object", parseFailure: false, errorCode: failure.code, providerError: { code, status }, mcpIsError: null, contentTypes: [] };
    const result = await runRankMathAudit(async path => { if (path.includes("/run")) throw failure; return definition; });
    expect(result.status).toBe(expected);
    expect(result.diagnostics[1]?.http?.httpStatus).toBe(400);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("keeps a proven provider failure when malformed findings also fail parsing", async () => {
    const result = await runRankMathAudit(reader({ ...audit, findings: [{ unexpected: true }], error: { code: "provider_failed", message: "SECRET" } }));
    expect(result.status).toBe("failed");
    expect(result.diagnostics[1]?.parsingFailure).toBe("audit_finding_schema_mismatch");
    expect(JSON.stringify(logs.mock.calls)).toContain("audit_finding_schema_mismatch");
  });

  it("preserves partial findings while reporting remote analysis failure", async () => {
    const result = await runRankMathAudit(reader({ ...audit, remote_api_status: "unavailable", error: { code: "remote_failed", message: "SECRET" } }));
    expect(result.status).toBe("failed");
    expect(result.availability).toBe("partial");
    expect(result.findings).toHaveLength(1);
  });

  it("never executes an unsupported discovery result", async () => {
    const read = jest.fn<RankMathRead>().mockResolvedValue({ ...definition, meta: { annotations: { readonly: false } } });
    expect((await runRankMathAudit(read)).status).toBe("unsupported");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("preserves immutable legacy receipts and adds an unknown read-time status", () => {
    const old = { id: "old", result: { availability: "unavailable", score: null, findings: [] } };
    expect(rankMathOutcomeStatus(old)).toMatchObject({ status: "unknown", result: { status: "unknown" } });
    expect(old).not.toHaveProperty("status");
    expect(old.result).not.toHaveProperty("status");
  });

  it("records the transport HTTP status and duration without raw payloads", async () => {
    const result = await readRankMathTool(async (_path, _method, observer) => {
      observer?.({ httpStatus: 200, durationMs: 7, responseType: "object", parseFailure: false, errorCode: null, providerError: null, mcpIsError: false, contentTypes: [] });
      return { ...audit, credentials: "SECRET" };
    }, "audit-site-seo", "execution", "?input%5Brefresh%5D=true");
    expect(result.diagnostic.http?.httpStatus).toBe(200);
    expect(result.diagnostic.http?.durationMs).toBe(7);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("SECRET");
  });

  it("tests the post evidence tool independently without inventing an executed score", async () => {
    const calls: string[] = [];
    const result = await analyzeRankMathPost(async path => {
      calls.push(path);
      return path.includes("/run") ? { post_id: 5652, tests_to_run: ["keywordInTitle"], content: { title: "SECRET title", body: "SECRET body", word_count: 2 }, error: null } : { name: "rank-math/analyze-post-content", input_schema: { properties: { post_id: { type: "integer" } } }, meta: { annotations: { readonly: true } } };
    }, 5652);
    expect(result.status).toBe("success");
    expect(result.score).toBeNull();
    expect(result.findings).toEqual([]);
    expect(result.testsToRun).toEqual(["keywordInTitle"]);
    expect(result.contentSummary?.wordCount).toBe(2);
    expect(calls[1]).toBe("/wp-abilities/v1/abilities/rank-math/analyze-post-content/run?input%5Bpost_id%5D=5652");
    expect(calls.some(p => p.includes("audit-site-seo"))).toBe(false);
    expect(JSON.stringify([result, logs.mock.calls])).not.toContain("SECRET");
  });
});
