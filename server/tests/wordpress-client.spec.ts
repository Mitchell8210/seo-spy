import "reflect-metadata";
import { jest } from "@jest/globals";
import { IncomingMessage, type IncomingHttpHeaders } from "node:http";
import { Socket } from "node:net";
import { WebsiteDns } from "../src/integrations/website/collector.js";
import { WordPressClient, WordPressTransport, readWordPressResponse, WORDPRESS_MAX_BYTES, WordPressRequestError, type WordPressConnection, type WordPressDiagnostic } from "../src/integrations/wordpress/wordpress.client.js";

const connection: WordPressConnection = { businessId: "business", siteUrl: "https://example.com", username: "operator", applicationPassword: "private application password" };
function fixture() {
  const dns = new WebsiteDns();
  const transport = new WordPressTransport();
  const resolve = jest.spyOn(dns, "resolve").mockResolvedValue(["8.8.8.8"]);
  const send = jest.spyOn(transport, "send").mockResolvedValue({ id: 12 });
  return { client: new WordPressClient(dns, transport), resolve, send };
}
function response(status = 200, headers: IncomingHttpHeaders = { "content-type": "application/json" }, address = "8.8.8.8") {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: address });
  const message = new IncomingMessage(socket);
  message.statusCode = status;
  message.headers = headers;
  return message;
}

describe("WordPress credentialed transport policy", () => {
  it("validates DNS, pins the chosen public address and passes credentials only to the fixed origin", async () => {
    const f = fixture();
    await expect(f.client.request(connection, "GET", "/wp-json/wp/v2/pages?context=edit")).resolves.toEqual({ id: 12 });
    expect(f.resolve).toHaveBeenCalledWith("example.com");
    const [url, address, method, authorization, body, signal] = f.send.mock.calls[0]!;
    expect(url.origin).toBe("https://example.com");
    expect(url.pathname).toBe("/wp-json/wp/v2/pages");
    expect(address).toBe("8.8.8.8"); expect(method).toBe("GET"); expect(body).toBeUndefined();
    expect(authorization).toBe(`Basic ${Buffer.from("operator:privateapplicationpassword").toString("base64")}`);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["http://example.com", "https://user:pass@example.com", "https://example.com:444", "https://localhost", "https://127.0.0.1", "https://example.com/subpath", "https://example.com?x=1", "https://example.com#fragment"])("blocks invalid installation %s before sending credentials", async siteUrl => {
    const f = fixture();
    await expect(f.client.request({ ...connection, siteUrl }, "GET", "/wp-json/")).rejects.toMatchObject({ code: "WORDPRESS_BLOCKED_DESTINATION" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it.each(["https://attacker.example/wp-json/", "//attacker.example/wp-json/", "/wp-json/../admin", "/wp-json/%2e%2e/admin", "/wp-json/a\\b", "/wp-json/a#fragment", "/wp-admin/"])("blocks unsafe relative REST path %s", async path => {
    const f = fixture();
    await expect(f.client.request(connection, "GET", path)).rejects.toMatchObject({ code: "WORDPRESS_INVALID_PATH" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("rejects every mixed/public-private DNS result before connection", async () => {
    const f = fixture(); f.resolve.mockResolvedValue(["8.8.8.8", "127.0.0.1"]);
    await expect(f.client.request(connection, "OPTIONS", "/wp-json/wp/v2/pages")).rejects.toMatchObject({ code: "WORDPRESS_BLOCKED_DESTINATION" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("chooses one validated IPv4 address without automatic address retries", async () => {
    const f = fixture(); f.resolve.mockResolvedValue(["2606:4700:4700::1111", "8.8.8.8"]);
    await f.client.request(connection, "POST", "/wp-json/wp/v2/pages/12", { title: "Approved" });
    expect(f.send.mock.calls[0]?.[1]).toBe("8.8.8.8");
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("does not retry an uncertain write or expose upstream errors/credentials", async () => {
    const f = fixture();
    f.send.mockRejectedValue(new Error("private application password / provider details"));
    await expect(f.client.request(connection, "POST", "/wp-json/wp/v2/pages/12", { title: "Approved title" })).rejects.toMatchObject({ code: "WORDPRESS_REQUEST_FAILED", message: "The WordPress request failed. Its outcome may require reconciliation." });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("observes response status, duration and tool shape without bodies, credentials or query values", async () => {
    const f = fixture();
    f.send.mockImplementation(async (_url, _address, _method, _authorization, _body, _signal, observe) => {
      observe?.({ httpStatus: 200, responseType: "object", parseFailure: false, providerError: null, mcpIsError: false, contentTypes: ["text"] });
      return { isError: false, content: [{ type: "text", text: "private response and secret query" }], private_token: "private application password" };
    });
    const diagnostics: WordPressDiagnostic[] = [];
    await f.client.request(connection, "GET", "/wp-json/?private=secret", undefined, value => diagnostics.push(value));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ httpStatus: 200, responseType: "object", parseFailure: false, errorCode: null, mcpIsError: false, contentTypes: ["text"] });
    expect(diagnostics[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(diagnostics)).not.toMatch(/password|private|secret|Basic/);
  });

  it("attaches safe failure diagnostics and isolates observer exceptions", async () => {
    const f = fixture();
    f.send.mockRejectedValue(new WordPressRequestError("WORDPRESS_CONNECTION_TIMEOUT", "WordPress connection timed out."));
    const diagnostics: WordPressDiagnostic[] = [];
    await expect(f.client.request(connection, "GET", "/wp-json/", undefined, value => diagnostics.push(value))).rejects.toMatchObject({
      diagnostic: { httpStatus: null, errorCode: "WORDPRESS_CONNECTION_TIMEOUT", responseType: "unavailable" },
    });
    expect(diagnostics).toHaveLength(1);
    f.send.mockResolvedValue({});
    await expect(f.client.request(connection, "GET", "/wp-json/", undefined, () => { throw new Error("observer failure"); })).resolves.toEqual({});
  });

  it.each([null, false, undefined])("does not report an empty provider error (%s) as a failure", async error => {
    const f = fixture();
    f.send.mockResolvedValue({ error, score: 75 });
    const diagnostics: WordPressDiagnostic[] = [];
    await expect(f.client.request(connection, "GET", "/wp-json/", undefined, value => diagnostics.push(value))).resolves.toEqual({ error, score: 75 });
    expect(diagnostics[0]).toMatchObject({ providerError: null, errorCode: null, parseFailure: false });
  });

  it("bounds concurrent requests and releases reservations on failures", async () => {
    const f = fixture(); let release!: (value: unknown) => void;
    const blocked = new Promise(resolve => { release = resolve; });
    f.send.mockReturnValue(blocked);
    const first = f.client.request(connection, "GET", "/wp-json/");
    const second = f.client.request(connection, "GET", "/wp-json/");
    await expect(f.client.request(connection, "GET", "/wp-json/")).rejects.toMatchObject({ code: "WORDPRESS_BUSY" });
    release({}); await Promise.all([first, second]);
    f.send.mockResolvedValue({});
    await expect(f.client.request(connection, "GET", "/wp-json/")).resolves.toEqual({});
  });

  it("rejects oversized updates and GET bodies before dispatch", async () => {
    const f = fixture();
    await expect(f.client.request(connection, "POST", "/wp-json/wp/v2/pages/12", { content: "x".repeat(256 * 1024) })).rejects.toMatchObject({ code: "WORDPRESS_REQUEST_TOO_LARGE" });
    await expect(f.client.request(connection, "GET", "/wp-json/", {})).rejects.toMatchObject({ code: "WORDPRESS_INVALID_REQUEST" });
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe("WordPress response boundary", () => {
  it("parses JSON and preserves zero and null", async () => {
    const stream = response(); const result = readWordPressResponse(stream, "8.8.8.8");
    stream.emit("data", Buffer.from('{"score":0,"missing":null}')); stream.emit("end");
    await expect(result).resolves.toEqual({ score: 0, missing: null });
  });
  it.each(["127.0.0.1", "8.8.4.4"])("rejects mismatched or nonpublic actual remote address %s", async address => {
    const stream = response(200, { "content-type": "application/json" }, address);
    await expect(readWordPressResponse(stream, "8.8.8.8")).rejects.toMatchObject({ code: "WORDPRESS_BLOCKED_DESTINATION" });
  });
  it.each([301, 302, 307, 308])("rejects redirect %s without following it", async status => {
    await expect(readWordPressResponse(response(status), "8.8.8.8")).rejects.toMatchObject({ code: "WORDPRESS_REDIRECT_REJECTED", httpStatus: status });
  });
  it.each([401, 403])("reports safe permission rejection for HTTP %s", async status => {
    const stream = response(status); const result = readWordPressResponse(stream, "8.8.8.8");
    stream.emit("data", Buffer.from('{"code":"rest_forbidden","message":"private provider message","data":{"status":403,"token":"secret"}}')); stream.emit("end");
    await expect(result).rejects.toMatchObject({ code: "WORDPRESS_ACCESS_DENIED", httpStatus: status });
  });
  it("retains only structured provider error codes and numeric status from bounded error JSON", async () => {
    const stream = response(400);
    const seen: unknown[] = [];
    const result = readWordPressResponse(stream, "8.8.8.8", value => seen.push(value));
    stream.emit("data", Buffer.from('{"error":{"code":-32602,"message":"secret input","data":{"status":400,"token":"secret"}}}')); stream.emit("end");
    await expect(result).rejects.toMatchObject({ httpStatus: 400, code: "WORDPRESS_HTTP_ERROR" });
    expect(seen.at(-1)).toMatchObject({ httpStatus: 400, providerError: { code: -32602, status: 400 }, responseType: "object", parseFailure: false });
    expect(JSON.stringify(seen)).not.toMatch(/secret|message|token/);
  });
  it("distinguishes malformed JSON from an HTTP rejection without logging the payload", async () => {
    const stream = response(502);
    const seen: unknown[] = [];
    const result = readWordPressResponse(stream, "8.8.8.8", value => seen.push(value));
    stream.emit("data", Buffer.from("private malformed payload")); stream.emit("end");
    await expect(result).rejects.toMatchObject({ httpStatus: 502, code: "WORDPRESS_HTTP_ERROR" });
    expect(seen.at(-1)).toMatchObject({ httpStatus: 502, parseFailure: true, responseType: "unavailable" });
    expect(JSON.stringify(seen)).not.toContain("private");
  });
  it("applies the existing body size limit to provider error responses too", async () => {
    const stream = response(500);
    const seen: unknown[] = [];
    const result = readWordPressResponse(stream, "8.8.8.8", value => seen.push(value));
    stream.emit("data", Buffer.alloc(WORDPRESS_MAX_BYTES + 1));
    await expect(result).rejects.toMatchObject({ code: "WORDPRESS_RESPONSE_TOO_LARGE" });
    expect(seen.at(-1)).toMatchObject({ httpStatus: 500, responseType: "unavailable" });
  });
  it("rejects compressed, non-JSON, oversized and invalid JSON responses", async () => {
    await expect(readWordPressResponse(response(200, { "content-type": "text/html" }), "8.8.8.8")).rejects.toMatchObject({ code: "WORDPRESS_INVALID_RESPONSE" });
    await expect(readWordPressResponse(response(200, { "content-type": "application/json", "content-encoding": "gzip" }), "8.8.8.8")).rejects.toMatchObject({ code: "WORDPRESS_UNSUPPORTED_ENCODING" });
    const big = response(); const tooLarge = readWordPressResponse(big, "8.8.8.8");
    big.emit("data", Buffer.alloc(WORDPRESS_MAX_BYTES + 1));
    await expect(tooLarge).rejects.toMatchObject({ code: "WORDPRESS_RESPONSE_TOO_LARGE" });
    const invalid = response(); const malformed = readWordPressResponse(invalid, "8.8.8.8");
    invalid.emit("data", Buffer.from("not json")); invalid.emit("end");
    await expect(malformed).rejects.toMatchObject({ code: "WORDPRESS_INVALID_RESPONSE" });
  });
});
