import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { GoogleApiError, GoogleTransport, GOOGLE_MAX_RESPONSE_BYTES, GOOGLE_TOKEN_URL, readGoogleResponse, validateGoogleDestination } from "../src/integrations/google/google-transport.js";

const ga4 = "https://analyticsdata.googleapis.com/v1beta/properties/123:batchRunReports";
const gsc = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent("https://example.com/")}/searchAnalytics/query`;
function stream(status = 200, headers: Record<string, string> = { "content-type": "application/json" }) {
  const response = new PassThrough() as unknown as IncomingMessage;
  response.statusCode = status; response.headers = headers;
  return response;
}
async function read(status: number, body: unknown) {
  const response = stream(status);
  const pending = readGoogleResponse(response);
  response.emit("data", Buffer.from(JSON.stringify(body))); response.emit("end");
  return pending;
}

describe("fixed Google report transport destination boundary", () => {
  it.each([GOOGLE_TOKEN_URL, ga4, gsc, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent("sc-domain:example.com")}/searchAnalytics/query`])("accepts only supported endpoint %s", destination => {
    expect(validateGoogleDestination(destination).href).toBe(destination);
  });
  it.each([
    "http://oauth2.googleapis.com/token", "https://user:secret@oauth2.googleapis.com/token", "https://oauth2.googleapis.com:8443/token", "https://oauth2.googleapis.com/token?redirect=secret", "https://oauth2.googleapis.com/token#private", "https://attacker.example/", "https://api.meta.ai/v1/responses", "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport", "https://analyticsdata.googleapis.com/v1beta/properties/invalid:batchRunReports", "https://www.googleapis.com/webmasters/v3/sites/x/searchAnalytics/query", "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fuser%3Asecret%40example.com%2F/searchAnalytics/query",
  ])("rejects unsupported destinations without a network request %s", destination => {
    expect(() => validateGoogleDestination(destination)).toThrow(GoogleApiError);
  });
  it("rejects missing tokens, incorrect request formats, invalid limits and oversized bodies before networking", async () => {
    const transport = new GoogleTransport(new ConfigService());
    await expect(transport.post(ga4, {})).rejects.toMatchObject({ code: "GOOGLE_AUTH_FAILED" });
    await expect(transport.post(ga4, {}, { accessToken: "header\ninjection" })).rejects.toMatchObject({ code: "GOOGLE_AUTH_FAILED" });
    await expect(transport.post(GOOGLE_TOKEN_URL, {}, { contentType: "application/json" })).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    await expect(transport.post(ga4, { content: "x".repeat(128 * 1024) }, { accessToken: "fixture" })).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    const invalid = new GoogleTransport(new ConfigService({ GOOGLE_TIMEOUT_MS: 30001 }));
    await expect(invalid.post(ga4, {}, { accessToken: "fixture" })).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
  });
});

describe("bounded Google response parsing and safe provider diagnostics", () => {
  it.each([
    [403, { error: { status: "PERMISSION_DENIED", message: "private key private-account@example.test", details: [{ reason: "SERVICE_DISABLED" }] } }, "GOOGLE_API_DISABLED", "SERVICE_DISABLED"],
    [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }, "GOOGLE_API_DISABLED", "accessNotConfigured"],
    [403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }, "GOOGLE_PERMISSION_DENIED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"],
    [403, { error: { errors: [{ reason: "insufficientPermissions" }] } }, "GOOGLE_PERMISSION_DENIED", "insufficientPermissions"],
    [401, { error: { status: "UNAUTHENTICATED" } }, "GOOGLE_AUTH_FAILED", "UNAUTHENTICATED"],
    [400, { error: "invalid_grant", error_description: "private credentials" }, "GOOGLE_AUTH_FAILED", "invalid_grant"],
    [429, { error: { status: "RESOURCE_EXHAUSTED" } }, "GOOGLE_RATE_LIMITED", "RESOURCE_EXHAUSTED"],
    [403, { error: { errors: [{ reason: "quotaExceeded" }] } }, "GOOGLE_RATE_LIMITED", "quotaExceeded"],
    [500, { error: { message: "private provider secret", errors: [{ reason: "private arbitrary reason" }] } }, "GOOGLE_UNAVAILABLE", null],
  ])("classifies HTTP %i without returning private provider details", async (status, body, code, reason) => {
    try { await read(Number(status), body); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toMatchObject({ code, reason, httpStatus: status });
      expect(String(error)).not.toContain("private");
      expect(String(error)).not.toContain("fixture-account");
    }
  });
  it.each([
    [302, { "content-type": "application/json" }],
    [200, { "content-type": "text/html" }],
    [200, { "content-type": "application/json", "content-encoding": "gzip" }],
    [200, { "content-type": "application/json", "content-length": String(GOOGLE_MAX_RESPONSE_BYTES + 1) }],
    [200, { "content-type": "application/json", "content-length": "invalid" }],
  ])("rejects redirect or invalid/oversized declared response %i", async (status, headers) => {
    await expect(readGoogleResponse(stream(Number(status), headers as Record<string, string>))).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
  });
  it("bounds streamed bytes, safely handles malformed errors, and returns ordinary empty JSON", async () => {
    const oversized = stream(); const large = readGoogleResponse(oversized);
    oversized.emit("data", Buffer.alloc(GOOGLE_MAX_RESPONSE_BYTES + 1));
    await expect(large).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
    const invalid = stream(); const malformed = readGoogleResponse(invalid);
    invalid.emit("data", Buffer.from("private invalid json")); invalid.emit("end");
    await expect(malformed).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
    const broken = stream(401); const unauthorized = readGoogleResponse(broken);
    broken.emit("data", Buffer.from("private invalid error json")); broken.emit("end");
    await expect(unauthorized).rejects.toMatchObject({ code: "GOOGLE_AUTH_FAILED" });
    await expect(read(200, {})).resolves.toEqual({});
  });
  it("classifies a non-JSON permission response and interrupted streams safely", async () => {
    await expect(readGoogleResponse(stream(403, { "content-type": "text/html" }))).rejects.toMatchObject({ code: "GOOGLE_PERMISSION_DENIED" });
    const broken = stream(); const pending = readGoogleResponse(broken); broken.emit("aborted");
    await expect(pending).rejects.toMatchObject({ code: "GOOGLE_UNAVAILABLE" });
  });
});
