import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { IncomingMessage, type IncomingHttpHeaders } from "node:http";
import { Socket } from "node:net";
import { WordPressImageContent } from "../src/integrations/wordpress/image-content.js";
import { MAX_BYTES, readPageResponse, WebsiteDns, WebsiteTransport, type PageResponse } from "../src/integrations/website/collector.js";

const site = "https://example.com", source = "https://www.example.com/original.png?version=exact";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
describe("exact WordPress raster byte fingerprints using protected mocked transport", () => {
  let dns: ReturnType<typeof jest.fn<WebsiteDns["resolve"]>>, fetch: ReturnType<typeof jest.fn<WebsiteTransport["fetch"]>>, service: WordPressImageContent;
  let response: PageResponse;
  beforeEach(() => {
    dns = jest.fn<WebsiteDns["resolve"]>().mockResolvedValue(["8.8.8.8", "1.1.1.1"]);
    response = { status: 200, contentType: "image/png", robots: "", body: png };
    fetch = jest.fn<WebsiteTransport["fetch"]>().mockImplementation(async () => response);
    service = new WordPressImageContent({ resolve: dns }, { fetch });
  });
  afterEach(() => { jest.restoreAllMocks(); });
  it("pins only the first validated address and preserves exact URL/query and raster transport mode", async () => {
    const result = await service.fingerprint(source, site);
    expect(result).toEqual({ sourceUrl: source, sha256: createHash("sha256").update(png).digest("hex"), bytes: png.length, collectedAt: expect.any(String) });
    expect(Number.isFinite(Date.parse(result.collectedAt))).toBe(true);
    expect(dns).toHaveBeenCalledWith("www.example.com");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(new URL(source), "8.8.8.8", expect.any(AbortSignal), "raster-image");
  });
  it("detects different source bytes served at the identical URL", async () => {
    const before = await service.fingerprint(source, site);
    response.body = Buffer.concat([png, Buffer.from("new bytes")]);
    const after = await service.fingerprint(source, site);
    expect(after.sourceUrl).toBe(before.sourceUrl); expect(after.sha256).not.toBe(before.sha256);
  });
  it.each([
    "http://www.example.com/image.png", "https://unrelated.example/image.png", "https://user:password@example.com/image.png",
    "https://example.com:8443/image.png", "https://example.com/image.png#fragment", "https://127.0.0.1/image.png", "javascript:alert(1)", "not-a-url",
  ])("rejects unsafe or unrelated exact source %s before DNS/transport", async url => {
    await expect(service.fingerprint(url, site)).rejects.toBeDefined(); expect(dns).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[], ["8.8.8.8", "127.0.0.1"], ["8.8.8.8", "::1"], ["bad-address"]].map(addresses => ({ addresses })))("rejects every DNS set containing unavailable/private answers $addresses", async ({ addresses }) => {
    dns.mockResolvedValue(addresses); await expect(service.fingerprint(source, site)).rejects.toMatchObject({ code: "BLOCKED_DESTINATION" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("makes no address fallback or request retry after a transport failure", async () => {
    fetch.mockRejectedValue(new Error("Offline connection failure"));
    await expect(service.fingerprint(source, site)).rejects.toMatchObject({ code: "COLLECTION_FAILED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([301, 302, 303, 307, 308])("rejects HTTP %s redirects without following their destination", async status => {
    response.status = status; response.location = "https://unrelated.example/image.png";
    await expect(service.fingerprint(source, site)).rejects.toMatchObject({ code: "IMAGE_REDIRECT_REJECTED" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([204, 206, 404, 503])("rejects incomplete/non-200 HTTP %s", async status => {
    response.status = status; await expect(service.fingerprint(source, site)).rejects.toMatchObject({ code: "HTTP_ERROR" });
  });
  it.each([
    { contentType: "image/svg+xml", body: Buffer.from("<svg/>") }, { contentType: "text/html", body: png },
    { contentType: "image/png", body: Buffer.from("<script>not raster</script>") }, { contentType: "image/jpeg", body: png },
    { contentType: "image/webp", body: Buffer.from("RIFFwrong") }, { contentType: "image/gif", body: Buffer.from("GIFwrong") },
  ])("rejects unsupported MIME or mismatched raster magic $contentType", async fixture => {
    Object.assign(response, fixture); await expect(service.fingerprint(source, site)).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID" });
  });
  it.each([
    { contentType: "image/jpeg", body: Buffer.from([255, 216, 255, 255, 217]) },
    { contentType: "image/webp", body: Buffer.from("RIFF0000WEBP") },
    { contentType: "image/gif", body: Buffer.from("GIF87a") }, { contentType: "image/gif", body: Buffer.from("GIF89a") },
  ])("hashes supported basic $contentType signatures without claiming image decoding", async fixture => {
    Object.assign(response, fixture); expect((await service.fingerprint(source, site)).bytes).toBe(fixture.body.length);
  });
  it("rejects a response body beyond the shared 2 MiB bound", async () => {
    response.body = Buffer.alloc(MAX_BYTES + 1); await expect(service.fingerprint(source, site)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
  it("honors caller cancellation before DNS and during pending DNS", async () => {
    const stopped = new AbortController(); stopped.abort();
    await expect(service.fingerprint(source, site, stopped.signal)).rejects.toMatchObject({ code: "SERVER_STOPPING" }); expect(dns).not.toHaveBeenCalled();
    const controller = new AbortController(); dns.mockImplementation(() => new Promise(() => {}));
    const pending = service.fingerprint(source, site, controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "SERVER_STOPPING" }); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["dns", "transport"])("applies a single 30-second deadline during pending %s work", async stage => {
    const deadline = new AbortController(); jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    if (stage === "dns") dns.mockImplementation(() => new Promise(() => {}));
    else fetch.mockImplementation(() => new Promise(() => {}));
    const pending = service.fingerprint(source, site); await Promise.resolve(); await Promise.resolve(); deadline.abort();
    await expect(pending).rejects.toMatchObject({ code: "COLLECTION_TIMEOUT" });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(30000); expect(fetch).toHaveBeenCalledTimes(stage === "dns" ? 0 : 1);
  });
  it("bounds concurrent image collections and releases capacity after cancellation", async () => {
    dns.mockImplementation(() => new Promise(() => {}));
    const first = new AbortController(), second = new AbortController();
    const one = service.fingerprint(source, site, first.signal), two = service.fingerprint(source, site, second.signal);
    await expect(service.fingerprint(source, site)).rejects.toMatchObject({ code: "COLLECTOR_BUSY" });
    first.abort(); second.abort(); await expect(one).rejects.toBeDefined(); await expect(two).rejects.toBeDefined();
    dns.mockResolvedValue(["8.8.8.8"]);
    expect((await service.fingerprint(source, site)).bytes).toBe(png.length);
  });
});

describe("shared raster response reader keeps remote-address and body protections", () => {
  function message(headers: IncomingHttpHeaders = { "content-type": "image/png" }, remote = "8.8.8.8") {
    const socket = new Socket(); Object.defineProperty(socket, "remoteAddress", { value: remote });
    const response = new IncomingMessage(socket); response.statusCode = 200; response.headers = headers;
    return response;
  }
  it("retains HTML-only behavior unless raster mode is explicitly requested", async () => {
    await expect(readPageResponse(message(), "8.8.8.8")).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });
    const response = message(), pending = readPageResponse(response, "8.8.8.8", "raster-image"); response.push(png); response.push(null);
    expect((await pending).body).toEqual(png);
  });
  it.each(["127.0.0.1", "1.1.1.1"])("rejects unvalidated remote socket %s", async remote => {
    await expect(readPageResponse(message(undefined, remote), "8.8.8.8", "raster-image")).rejects.toMatchObject({ code: "BLOCKED_DESTINATION" });
  });
  it.each([
    { headers: { "content-type": "image/png", "content-encoding": "gzip" }, code: "UNSUPPORTED_ENCODING" },
    { headers: { "content-type": "image/svg+xml" }, code: "UNSUPPORTED_CONTENT_TYPE" },
    { headers: { "content-type": "image/png", "content-length": String(MAX_BYTES + 1) }, code: "RESPONSE_TOO_LARGE" },
  ])("rejects forbidden image response properties $code", async fixture => {
    await expect(readPageResponse(message(fixture.headers), "8.8.8.8", "raster-image")).rejects.toMatchObject({ code: fixture.code });
  });
  it("enforces the streamed raster byte bound without trusting Content-Length", async () => {
    const response = message(), pending = readPageResponse(response, "8.8.8.8", "raster-image");
    response.push(Buffer.alloc(MAX_BYTES + 1));
    await expect(pending).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});
