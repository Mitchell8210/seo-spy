import "reflect-metadata";
import { jest } from "@jest/globals";
import { IncomingMessage, type IncomingHttpHeaders } from "node:http";
import { Socket } from "node:net";
import { analyzeHomepage } from "../src/integrations/website/analyze.js";
import {
  CollectionError,
  MAX_BYTES,
  publicAddress,
  publicUrl,
  readPageResponse,
  WebsiteCollector,
  WebsiteDns,
  WebsiteTransport,
  type CollectedPage,
  type PageResponse,
} from "../src/integrations/website/collector.js";

function fixturePage(html: string): CollectedPage {
  return {
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    contentType: "text/html; charset=UTF-8",
    collectedAt: "2026-10-28T00:00:00.000Z",
    bytes: Buffer.byteLength(html),
    redirects: [],
    robots: "",
    body: Buffer.from(html),
  };
}

describe("homepage evidence and checks", () => {
  it("preserves Spanish, entities, document order, and successful evidence without findings", () => {
    const result = analyzeHomepage(
      fixturePage(
        '<title>Español &amp; Taxes</title><meta name="DESCRIPTION" content="Atención"><link rel="canonical" href="/"><h1>Contabilidad</h1><h2>Servicios</h2><img src="a.png" alt="Nuestro equipo">',
      ),
      "audit",
    );
    expect(result.findings).toEqual([]);
    expect(
      result.evidence.find((e) => e.checkId === "page-title")?.observed.values,
    ).toContain("Español & Taxes");
    expect(
      result.evidence.find((e) => e.checkId === "headings")?.observed.values,
    ).toContain("Servicios");
    expect(
      result.scores.every(
        (score) => score.value === null && score.availability === "unavailable",
      ),
    ).toBe(true);
  });

  it("links recommendations and findings to evidence, including contextual empty-alt review", () => {
    const page = fixturePage(
      '<h1>One</h1><h1>Two</h1><img src="a"><img src="b" alt=""><link rel="canonical" href="javascript:alert(1)">',
    );
    page.robots = "noindex";
    const result = analyzeHomepage(page, "audit");
    expect(result.findings.map((f) => f.checkId)).toEqual([
      "page-title",
      "meta-description",
      "headings",
      "canonical",
      "robots",
      "image-alt",
    ]);
    for (const finding of result.findings) {
      expect(
        result.evidence.some(
          (e) => finding.evidenceIds.includes(e.id) && e.mode === "live",
        ),
      ).toBe(true);
      expect(
        result.recommendations.some((r) => r.findingId === finding.id),
      ).toBe(true);
    }
    expect(
      result.findings.find((f) => f.checkId === "image-alt")?.explanation,
    ).toContain("decorative");
    expect(
      result.evidence.find((e) => e.checkId === "image-alt")?.observed,
    ).toMatchObject({ missingCount: "1", emptyCount: "1" });
  });
});

describe("public destination policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("blocks %s", (address) => {
    expect(publicAddress(address)).toBe(false);
  });
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/",
    "http://user:pass@example.com",
    "http://example.com:8080",
    "http://localhost",
    "http://127.1",
    "http://2130706433",
    "http://[::ffff:127.0.0.1]",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => publicUrl(url)).toThrow();
  });
  it("allows public IPv4/IPv6 and standard ports", () => {
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
    expect(publicUrl("https://example.com:443/#section").href).toBe(
      "https://example.com/",
    );
  });
});

describe("bounded collection", () => {
  let dns: WebsiteDns;
  let transport: WebsiteTransport;
  let collector: WebsiteCollector;
  const ok: PageResponse = {
    status: 200,
    contentType: "text/html",
    robots: "",
    body: Buffer.from("<h1>Hello</h1>"),
  };
  beforeEach(() => {
    dns = new WebsiteDns();
    transport = new WebsiteTransport();
    jest.spyOn(dns, "resolve").mockResolvedValue(["8.8.8.8"]);
    jest.spyOn(transport, "fetch").mockResolvedValue(ok);
    collector = new WebsiteCollector(dns, transport);
  });

  it("revalidates and pins DNS on each redirect and records the final URL", async () => {
    jest.mocked(transport.fetch).mockResolvedValueOnce({
      ...ok,
      status: 301,
      location: "https://www.example.com/",
    });
    const page = await collector.collect("https://example.com");
    expect(page).toMatchObject({
      requestedUrl: "https://example.com/",
      finalUrl: "https://www.example.com/",
      redirects: ["https://www.example.com/"],
    });
    expect(dns.resolve).toHaveBeenNthCalledWith(2, "www.example.com");
    expect(jest.mocked(transport.fetch).mock.calls[1]?.[1]).toBe("8.8.8.8");
  });
  it("blocks mixed public/private DNS answers before connecting", async () => {
    jest.mocked(dns.resolve).mockResolvedValue(["8.8.8.8", "10.0.0.1"]);
    await expect(
      collector.collect("https://example.com"),
    ).rejects.toMatchObject({ code: "BLOCKED_DESTINATION" });
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it("restricts registered-site verification redirects before resolving an unrelated host", async () => {
    jest.mocked(transport.fetch).mockResolvedValueOnce({ ...ok, status: 301, location: "https://other.example/" });
    await expect(collector.collect("https://example.com/", undefined, "https://example.com")).rejects.toMatchObject({ code: "TARGET_SITE_MISMATCH" });
    expect(dns.resolve).toHaveBeenCalledTimes(1);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it("permits the www alias within registered-site verification and rejects a mismatching initial target", async () => {
    await expect(collector.collect("https://different.example/", undefined, "https://example.com")).rejects.toMatchObject({ code: "TARGET_SITE_MISMATCH" });
    expect(transport.fetch).not.toHaveBeenCalled();
    jest.mocked(transport.fetch).mockResolvedValueOnce({ ...ok, status: 301, location: "https://www.example.com/page" });
    await expect(collector.collect("https://example.com/", undefined, "https://example.com")).resolves.toMatchObject({ finalUrl: "https://www.example.com/page" });
  });
  it.each(["ENETUNREACH", "ECONNREFUSED", "ETIMEDOUT"])(
    "falls back from an IPv6 %s failure to a validated IPv4 address",
    async (code) => {
      jest
        .mocked(dns.resolve)
        .mockResolvedValue(["2606:4700:4700::1111", "8.8.8.8"]);
      jest
        .mocked(transport.fetch)
        .mockRejectedValueOnce(
          Object.assign(new Error("Connection failed"), { code }),
        );
      await expect(
        collector.collect("https://example.com"),
      ).resolves.toMatchObject({ status: 200 });
      const calls = jest.mocked(transport.fetch).mock.calls;
      expect(calls.map((call) => call[1])).toEqual([
        "2606:4700:4700::1111",
        "8.8.8.8",
      ]);
      expect(calls[0]?.[2]).toBe(calls[1]?.[2]);
      expect(dns.resolve).toHaveBeenCalledTimes(1);
    },
  );
  it("fails safely and releases capacity when all validated addresses fail", async () => {
    jest
      .mocked(dns.resolve)
      .mockResolvedValue(["2606:4700:4700::1111", "8.8.8.8"]);
    jest
      .mocked(transport.fetch)
      .mockRejectedValue(
        Object.assign(new Error("Connection failed"), { code: "ENETUNREACH" }),
      );
    await expect(
      collector.collect("https://example.com"),
    ).rejects.toMatchObject({ code: "COLLECTION_FAILED" });
    expect(transport.fetch).toHaveBeenCalledTimes(2);
    jest.mocked(transport.fetch).mockResolvedValue(ok);
    await expect(
      collector.collect("https://example.com"),
    ).resolves.toMatchObject({ status: 200 });
  });
  it.each([
    new CollectionError("BLOCKED_DESTINATION", "Blocked destination"),
    new CollectionError("HTTP_ERROR", "HTTP 403"),
    new CollectionError("RESPONSE_TOO_LARGE", "Too large"),
    new CollectionError("UNSUPPORTED_CONTENT_TYPE", "Not HTML"),
    Object.assign(new Error("Invalid certificate"), {
      code: "CERT_HAS_EXPIRED",
    }),
  ])(
    "does not retry a policy, HTTP, content, or certificate failure: %s",
    async (error) => {
      jest
        .mocked(dns.resolve)
        .mockResolvedValue(["2606:4700:4700::1111", "8.8.8.8"]);
      jest.mocked(transport.fetch).mockRejectedValueOnce(error);
      await expect(collector.collect("https://example.com")).rejects.toThrow();
      expect(transport.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("does not attempt another address after shutdown", async () => {
    const shutdown = new AbortController();
    jest
      .mocked(dns.resolve)
      .mockResolvedValue(["2606:4700:4700::1111", "8.8.8.8"]);
    jest.mocked(transport.fetch).mockImplementationOnce(async () => {
      shutdown.abort();
      throw Object.assign(new Error("Connection failed"), {
        code: "ENETUNREACH",
      });
    });
    await expect(
      collector.collect("https://example.com", shutdown.signal),
    ).rejects.toMatchObject({ code: "SERVER_STOPPING" });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps the total deadline across fallback attempts", async () => {
    const deadline = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    try {
      jest
        .mocked(dns.resolve)
        .mockResolvedValue(["2606:4700:4700::1111", "8.8.8.8"]);
      jest.mocked(transport.fetch).mockImplementationOnce(async () => {
        deadline.abort();
        throw Object.assign(new Error("Connection timed out"), {
          code: "ETIMEDOUT",
        });
      });
      await expect(
        collector.collect("https://example.com"),
      ).rejects.toMatchObject({ code: "COLLECTION_TIMEOUT" });
      expect(transport.fetch).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });
  it("blocks redirect DNS rebinding", async () => {
    jest
      .mocked(transport.fetch)
      .mockResolvedValueOnce({ ...ok, status: 302, location: "/" });
    jest
      .mocked(dns.resolve)
      .mockResolvedValueOnce(["8.8.8.8"])
      .mockResolvedValueOnce(["127.0.0.1"]);
    await expect(
      collector.collect("https://example.com"),
    ).rejects.toMatchObject({ code: "BLOCKED_DESTINATION" });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["http://127.0.0.1/", "http://example.com/"])(
    "rejects unsafe redirects to %s",
    async (location) => {
      jest
        .mocked(transport.fetch)
        .mockResolvedValueOnce({ ...ok, status: 301, location });
      await expect(collector.collect("https://example.com")).rejects.toThrow();
      expect(transport.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("stops redirect loops", async () => {
    jest
      .mocked(transport.fetch)
      .mockResolvedValue({ ...ok, status: 302, location: "/" });
    await expect(
      collector.collect("https://example.com"),
    ).rejects.toMatchObject({ code: "REDIRECT_LIMIT" });
    expect(transport.fetch).toHaveBeenCalledTimes(6);
  });
  it("aborts DNS on shutdown and releases collector capacity", async () => {
    jest.mocked(dns.resolve).mockImplementation(() => new Promise(() => {}));
    const shutdown = new AbortController();
    const pending = collector.collect("https://example.com", shutdown.signal);
    shutdown.abort();
    await expect(pending).rejects.toMatchObject({ code: "SERVER_STOPPING" });
    jest.mocked(dns.resolve).mockResolvedValue(["8.8.8.8"]);
    await expect(
      collector.collect("https://example.com"),
    ).resolves.toMatchObject({ status: 200 });
  });
  it("bounds concurrent collection", async () => {
    jest.mocked(dns.resolve).mockImplementation(() => new Promise(() => {}));
    const shutdown = new AbortController();
    const first = collector.collect("https://example.com", shutdown.signal);
    const second = collector.collect("https://example.com", shutdown.signal);
    await expect(
      collector.collect("https://example.com"),
    ).rejects.toMatchObject({ code: "COLLECTOR_BUSY" });
    shutdown.abort();
    await Promise.all([
      expect(first).rejects.toThrow(),
      expect(second).rejects.toThrow(),
    ]);
  });

  it("reports a total deadline expiry while DNS is stalled", async () => {
    const deadline = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    try {
      jest.mocked(dns.resolve).mockImplementation(() => new Promise(() => {}));
      const pending = collector.collect("https://example.com");
      deadline.abort();
      await expect(pending).rejects.toMatchObject({
        code: "COLLECTION_TIMEOUT",
      });
    } finally {
      timeout.mockRestore();
    }
  });
});

describe("HTTP response restrictions", () => {
  function response(
    status = 200,
    headers: IncomingHttpHeaders = { "content-type": "text/html" },
    address = "8.8.8.8",
  ) {
    const socket = new Socket();
    Object.defineProperty(socket, "remoteAddress", { value: address });
    const message = new IncomingMessage(socket);
    message.statusCode = status;
    message.headers = headers;
    return message;
  }
  it.each([
    [403, { "content-type": "text/html" }, "HTTP_ERROR"],
    [200, { "content-type": "application/json" }, "UNSUPPORTED_CONTENT_TYPE"],
    [
      200,
      { "content-type": "text/html", "content-length": String(MAX_BYTES + 1) },
      "RESPONSE_TOO_LARGE",
    ],
    [
      200,
      { "content-type": "text/html", "content-encoding": "gzip" },
      "UNSUPPORTED_ENCODING",
    ],
  ] as const)(
    "rejects HTTP %s with restricted headers",
    async (status, headers, code) => {
      await expect(
        readPageResponse(response(status, headers), "8.8.8.8"),
      ).rejects.toMatchObject({ code });
    },
  );
  it("rejects an actual remote address mismatch", async () => {
    await expect(
      readPageResponse(response(200, undefined, "127.0.0.1"), "8.8.8.8"),
    ).rejects.toMatchObject({ code: "BLOCKED_DESTINATION" });
  });
  it("limits streamed bytes even without Content-Length", async () => {
    const message = response();
    const result = readPageResponse(message, "8.8.8.8");
    message.emit("data", Buffer.alloc(MAX_BYTES));
    message.emit("data", Buffer.alloc(1));
    await expect(result).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
  it("returns bounded HTML and robots headers", async () => {
    const message = response(200, {
      "content-type": "text/html",
      "x-robots-tag": "noindex",
    });
    const result = readPageResponse(message, "8.8.8.8");
    message.emit("data", Buffer.from("<h1>Test</h1>"));
    message.emit("end");
    await expect(result).resolves.toMatchObject({
      status: 200,
      robots: "noindex",
      body: Buffer.from("<h1>Test</h1>"),
    });
  });
});
