import "reflect-metadata";
import { jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import request from "supertest";
import { configureApp } from "../src/configure-app.js";
import { FacebookModule } from "../src/modules/facebook/facebook.module.js";
import {
  FacebookError,
  FacebookGraph,
  FacebookService,
  READ_PERMISSIONS,
} from "../src/modules/facebook/facebook.service.js";
import {
  FacebookCredentialsStore,
  type FacebookCredential,
} from "../src/modules/facebook/facebook-credentials.store.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import { FacebookReportsService } from "../src/modules/facebook/facebook-reports.service.js";

const ORIGIN = "http://localhost:3001";
const USER_TOKEN = "private-user-token";
const PAGE_TOKEN = "private-page-token";
const config = () =>
  new ConfigService({
    FACEBOOK_APP_ID: "12345",
    FACEBOOK_APP_SECRET: "private-app-secret",
    FACEBOOK_CONFIG_ID: "67890",
    FACEBOOK_ACCESS_TOKEN: USER_TOKEN,
    FACEBOOK_REDIRECT_URI: `${ORIGIN}/api/facebook/callback`,
    FACEBOOK_GRAPH_VERSION: "v26.0",
    FACEBOOK_TOKEN_KEY: Buffer.alloc(32, 1).toString("base64"),
  });
function credentialMock() {
  const saved = new Map<string, FacebookCredential>();
  return {
    save: jest.fn(async (id: string, value: FacebookCredential) => {
      saved.set(id, value);
    }),
    read: jest.fn(async (id: string) => saved.get(id) ?? null),
    remove: jest.fn(async (id: string) => {
      saved.delete(id);
    }),
  };
}
const permissions = () => ({
  data: READ_PERMISSIONS.map((permission) => ({
    permission,
    status: "granted",
  })),
});
class MockFacebookGraph extends FacebookGraph {
  override request = jest.fn<FacebookGraph["request"]>();
}
const graphMock = () => new MockFacebookGraph(config());

describe("Facebook Graph transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the versioned Meta endpoint, bearer auth, secret proof and bounded nonredirecting requests", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    const graph = new FacebookGraph(config());
    await expect(
      graph.request("me/permissions", USER_TOKEN, { limit: "5" }),
    ).resolves.toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, options] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe("/v26.0/me/permissions");
    expect(url.searchParams.get("appsecret_proof")).toBe(
      createHmac("sha256", "private-app-secret")
        .update(USER_TOKEN)
        .digest("hex"),
    );
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.toString()).not.toContain(USER_TOKEN);
    expect(options).toMatchObject({
      method: "GET",
      headers: { Authorization: `Bearer ${USER_TOKEN}` },
      redirect: "error",
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("exposes safe numeric provider codes without the provider body or credentials", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: `Provider message with ${USER_TOKEN}`,
            code: 190,
            error_subcode: 467,
            fbtrace_id: "private-trace",
          },
        }),
        { status: 400 },
      ),
    );
    const graph = new FacebookGraph(config());
    const error: unknown = await graph
      .request("me/permissions", USER_TOKEN)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FacebookError);
    expect(error).toMatchObject({
      code: "PROVIDER_REJECTED",
      providerCode: 190,
      providerSubcode: 467,
      message: "PROVIDER_REJECTED",
    });
    expect(JSON.stringify(error)).not.toContain(USER_TOKEN);
    expect(JSON.stringify(error)).not.toContain("private-trace");
    expect(String(error)).not.toContain("Provider message");
  });

  it("converts malformed JSON into a safe transport failure", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(`not JSON ${USER_TOKEN}`));
    await expect(
      new FacebookGraph(config()).request("me/permissions", USER_TOKEN),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "PROVIDER_UNAVAILABLE",
    });
  });

  it("rejects responses larger than 2 MiB before parsing their body", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(
      new FacebookGraph(config()).request("me/permissions", USER_TOKEN),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});

describe("Facebook local service", () => {
  it("binds state to a session, consumes it once, and rotates the session after exchange", async () => {
    const graph = graphMock();
    graph.request.mockImplementation(async (path) =>
      path === "me/permissions"
        ? permissions()
        : path === "debug_token"
          ? {
              data: {
                is_valid: true,
                app_id: "12345",
                type: "USER",
                expires_at: Math.floor(Date.now() / 1000) + 86400,
              },
            }
          : { access_token: USER_TOKEN },
    );
    const store = credentialMock();
    const service = new FacebookService(
      config(),
      graph,
      store as unknown as FacebookCredentialsStore,
    );
    const first = service.start();
    const second = service.start();
    const state = new URL(first.url).searchParams.get("state");
    expect(new URL(first.url).searchParams.get("config_id")).toBe("67890");
    await expect(
      service.callback(second.id, state, "code", false),
    ).rejects.toThrow("Invalid Facebook authorization state");
    await expect(
      service.callback(undefined, state, "code", false),
    ).rejects.toThrow();
    expect(graph.request).not.toHaveBeenCalled();
    const connected = await service.callback(first.id, state, "code", false);
    expect(connected).not.toBe(first.id);
    expect(graph.request).toHaveBeenCalledWith(
      "oauth/access_token",
      "",
      expect.objectContaining({
        code: "code",
        redirect_uri: `${ORIGIN}/api/facebook/callback`,
      }),
      false,
    );
    await expect(
      service.callback(first.id, state, "code", false),
    ).rejects.toThrow();
    expect(graph.request).toHaveBeenCalledTimes(4);
    expect(graph.request).toHaveBeenCalledWith(
      "oauth/access_token",
      "",
      expect.objectContaining({
        grant_type: "fb_exchange_token",
        fb_exchange_token: USER_TOKEN,
      }),
      false,
    );
    expect(store.save).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    const restarted = new FacebookService(
      config(),
      graph,
      store as unknown as FacebookCredentialsStore,
    );
    await expect(restarted.credential(connected)).resolves.toMatchObject({
      token: USER_TOKEN,
    });
    await restarted.markReconnect(connected);
    await expect(restarted.credential(connected)).rejects.toThrow();
  });

  it("consumes cancelled authorization without exchanging a code", async () => {
    const graph = graphMock();
    const service = new FacebookService(config(), graph);
    const started = service.start();
    const state = new URL(started.url).searchParams.get("state");
    await expect(
      service.callback(started.id, state, undefined, true),
    ).rejects.toThrow("cancelled");
    await expect(
      service.callback(started.id, state, "later-code", false),
    ).rejects.toThrow();
    expect(graph.request).not.toHaveBeenCalled();
  });

  it("reports missing permissions explicitly without attempting an unauthorized Page list", async () => {
    const graph = graphMock();
    graph.request.mockResolvedValue({
      data: [{ permission: "read_insights", status: "declined" }],
    });
    const service = new FacebookService(config(), graph);
    const result = await service.diagnose(service.useConfiguredToken());
    expect(result).toMatchObject({
      requiredPermissionsGranted: false,
      pages: [],
      pageListFailure: "MISSING_PAGES_SHOW_LIST",
      writesEnabled: false,
    });
    expect(result.permissions).toContainEqual({
      permission: "read_insights",
      required: true,
      status: "declined",
    });
    expect(result.permissions).toContainEqual({
      permission: "pages_show_list",
      required: true,
      status: "not_granted",
    });
    expect(graph.request).toHaveBeenCalledTimes(1);
  });

  it("preserves successful reads when insights fail and strips tokens and paging URLs", async () => {
    const graph = graphMock();
    graph.request.mockImplementation(async (path) => {
      if (path === "me/permissions") return permissions();
      if (path === "me/accounts")
        return {
          data: [
            {
              id: "99",
              name: "Test Page",
              access_token: PAGE_TOKEN,
              tasks: ["ANALYZE"],
            },
          ],
        };
      if (path === "99")
        return { id: "99", followers_count: 42, access_token: PAGE_TOKEN };
      if (path === "99/posts")
        return {
          data: [
            {
              id: "99_1",
              message: "<script>untrusted text</script>",
              access_token: PAGE_TOKEN,
            },
          ],
          paging: {
            next: `https://example.invalid/?access_token=${PAGE_TOKEN}`,
          },
        };
      throw new FacebookError("PROVIDER_REJECTED", 100);
    });
    const service = new FacebookService(config(), graph);
    const result = await service.diagnose(service.useConfiguredToken());
    expect(result).toMatchObject({
      requiredPermissionsGranted: true,
      pageListFailure: null,
      pages: [
        {
          id: "99",
          metadata: {
            status: "available",
            data: { id: "99", followers_count: 42 },
          },
          posts: {
            status: "available",
            data: [{ id: "99_1", message: "<script>untrusted text</script>" }],
          },
          insights: {
            status: "unavailable",
            code: "PROVIDER_REJECTED",
            providerCode: 100,
          },
        },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(USER_TOKEN);
    expect(serialized).not.toContain(PAGE_TOKEN);
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("example.invalid");
  });

  it("bounds Page pagination and reconstructs cursor requests instead of following provider URLs", async () => {
    const graph = graphMock();
    let batches = 0;
    graph.request.mockImplementation(async (path, _token, params) => {
      if (path === "me/permissions") return permissions();
      if (path === "me/accounts") {
        batches++;
        expect(params?.after).toBe(batches === 1 ? undefined : "cursor-1");
        return {
          data: Array.from({ length: 5 }, (_, index) => ({
            id: String(batches * 10 + index),
            name: `Page ${index}`,
          })),
          paging: {
            next: "https://attacker.invalid/steal",
            cursors: { after: `cursor-${batches}` },
          },
        };
      }
      throw new Error("Pages without a Page token must not be probed");
    });
    const service = new FacebookService(config(), graph);
    const result = await service.diagnose(service.useConfiguredToken());
    expect(result.pages).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(graph.request).toHaveBeenCalledTimes(3);
    expect(result.pages[0]).toMatchObject({
      metadata: { status: "unavailable", code: "NO_PAGE_TOKEN" },
    });
  });

  it("expires configured-token sessions after one hour", async () => {
    const graph = graphMock();
    const service = new FacebookService(config(), graph);
    const session = service.useConfiguredToken();
    const now = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(now + 3600001);
    try {
      await expect(service.diagnose(session)).rejects.toThrow();
    } finally {
      clock.mockRestore();
    }
    expect(graph.request).not.toHaveBeenCalled();
  });

  it("rejects expired stored credentials and deletes them before any provider request", async () => {
    const store = credentialMock();
    const id = "a".repeat(64);
    await store.save(id, {
      token: USER_TOKEN,
      expiresAt: Date.now() - 1000,
      createdAt: new Date().toISOString(),
    });
    const graph = graphMock();
    const service = new FacebookService(
      config(),
      graph,
      store as unknown as FacebookCredentialsStore,
    );
    await expect(service.credential(id)).rejects.toThrow("reconnect");
    expect(store.remove).toHaveBeenCalledWith(id);
    expect(graph.request).not.toHaveBeenCalled();
  });

  it("requires all five read permissions rather than accepting only the analytics subset", async () => {
    const graph = graphMock();
    graph.request.mockResolvedValue({
      data: READ_PERMISSIONS.slice(0, 3).map((permission) => ({
        permission,
        status: "granted",
      })),
    });
    const service = new FacebookService(config(), graph);
    await expect(service.requirePermissions(USER_TOKEN)).rejects.toThrow(
      "five",
    );
  });
});

describe("Facebook local HTTP boundary", () => {
  let app: INestApplication;
  const graph = graphMock();
  let store: ReturnType<typeof credentialMock>;

  beforeEach(async () => {
    store = credentialMock();
    graph.request.mockReset();
    graph.request.mockImplementation(async (path) =>
      path === "me/permissions" ? permissions() : { data: [] },
    );
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FacebookModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(config())
      .overrideProvider(FacebookCredentialsStore)
      .useValue(store)
      .overrideProvider(FacebookGraph)
      .useValue(graph)
      .compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it("exchanges browser consent for validated persistent access and renders an escaped Page selector", async () => {
    graph.request.mockImplementation(async (path, _token, params) => {
      if (path === "oauth/access_token")
        return {
          access_token: params?.grant_type ? "private-long-lived" : USER_TOKEN,
        };
      if (path === "debug_token")
        return {
          data: {
            is_valid: true,
            app_id: "12345",
            type: "USER",
            expires_at: Math.floor(Date.now() / 1000) + 86400,
          },
        };
      if (path === "me/permissions") return permissions();
      return {
        data: [
          { id: "99", name: "<script>Page</script>", access_token: PAGE_TOKEN },
        ],
      };
    });
    const started = await request(app.getHttpServer())
      .post("/api/facebook/connect")
      .set("Host", "localhost:3001")
      .set("Origin", ORIGIN)
      .expect(303);
    const state = new URL(started.headers.location).searchParams.get("state");
    const cookie = (
      started.headers["set-cookie"] as unknown as string[]
    )[0]!.split(";")[0]!;
    const done = await request(app.getHttpServer())
      .get("/api/facebook/callback")
      .query({ state, code: "authorization-code" })
      .set("Host", "localhost:3001")
      .set("Cookie", cookie)
      .expect(303);
    const savedCookie = (done.headers["set-cookie"] as unknown as string[])[0]!;
    expect(savedCookie).toContain("Max-Age=2592000");
    expect(savedCookie).not.toContain("private-long-lived");
    expect(store.save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ token: "private-long-lived" }),
    );
    const home = await request(app.getHttpServer())
      .get("/api/facebook")
      .set("Host", "localhost:3001")
      .set("Cookie", savedCookie.split(";")[0]!)
      .expect(200);
    expect(home.text).toContain("Generate and save Facebook report");
    expect(home.text).toContain("&lt;script&gt;Page&lt;/script&gt;");
    expect(home.text).not.toContain("private-long-lived");
    expect(home.text).not.toContain(PAGE_TOKEN);
    await request(app.getHttpServer())
      .post("/api/facebook/reports")
      .set("Host", "localhost:3001")
      .set("Origin", "https://attacker.invalid")
      .send({ businessId: "demo-guzman", pageId: "99" })
      .expect(400);
  });

  it("rejects an untrusted Host and cross-origin or originless mutations", async () => {
    const home = await request(app.getHttpServer())
      .get("/api/facebook")
      .set("Host", "localhost:3001")
      .expect(200);
    expect(home.headers["referrer-policy"]).toBe("same-origin");
    const callback = await request(app.getHttpServer())
      .get("/api/facebook/callback")
      .set("Host", "localhost:3001")
      .expect(400);
    expect(callback.headers["referrer-policy"]).toBe("no-referrer");
    await request(app.getHttpServer())
      .get("/api/facebook/status")
      .set("Host", "attacker.invalid")
      .expect(400);
    for (const origin of ["https://attacker.invalid", "null"]) {
      await request(app.getHttpServer())
        .post("/api/facebook/test-token")
        .set("Host", "localhost:3001")
        .set("Origin", origin)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post("/api/facebook/test-token")
      .set("Host", "localhost:3001")
      .expect(400);
    expect(graph.request).not.toHaveBeenCalled();
  });

  it("allows the Facebook OAuth redirect in the login page policy while retaining strict defaults elsewhere", async () => {
    const home = await request(app.getHttpServer())
      .get("/api/facebook")
      .set("Host", "localhost:3001")
      .expect(200);
    expect(home.headers["content-security-policy"]).toContain(
      "form-action 'self' https://www.facebook.com",
    );
    expect(home.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    const connected = await request(app.getHttpServer())
      .post("/api/facebook/connect")
      .set("Host", "localhost:3001")
      .set("Origin", ORIGIN)
      .expect(303);
    expect(connected.headers["content-security-policy"]).toContain(
      "form-action 'self' https://www.facebook.com",
    );
    const destination = new URL(connected.headers.location);
    expect(destination.origin).toBe("https://www.facebook.com");
    expect(destination.searchParams.get("config_id")).toBe("67890");
    expect(destination.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/facebook/callback`,
    );
    const status = await request(app.getHttpServer())
      .get("/api/facebook/status")
      .set("Host", "localhost:3001")
      .expect(200);
    expect(status.headers["content-security-policy"]).toContain(
      "form-action 'self'",
    );
    expect(status.headers["content-security-policy"]).not.toContain(
      "facebook.com",
    );
    expect(graph.request).not.toHaveBeenCalled();
  });

  it("permits JSON reports only through the configured frontend Host and Origin while keeping OAuth backend-only", async () => {
    const id = "c".repeat(64);
    const create = jest.spyOn(app.get(FacebookReportsService), "create").mockResolvedValue({
      reportId: "saved", auditId: "saved", generatedAt: new Date().toISOString(), fileName: "saved.json",
      downloadUrl: "/api/audits/saved/report", status: "completed", failure: null,
    });
    try {
      const response = await request(app.getHttpServer()).post("/api/facebook/reports")
        .set("Host", "localhost:5173").set("Origin", "http://localhost:5173")
        .set("Cookie", `seo_spy_facebook_test=${id}`).send({ businessId: "demo-guzman", pageId: "99" }).expect(201);
      expect(response.body.status).toBe("completed");
      expect(create).toHaveBeenCalledWith(id, "demo-guzman", "99");
      for (const [host, origin] of [
        ["localhost:5173", "https://attacker.invalid"], ["localhost:5174", "http://localhost:5174"],
        ["localhost:3001", "http://localhost:5173"], ["127.0.0.1:5173", "http://127.0.0.1:5173"],
        ["localhost:5173", "null"],
      ]) {
        await request(app.getHttpServer()).post("/api/facebook/reports")
          .set("Host", host!).set("Origin", origin!).send({ businessId: "demo-guzman", pageId: "99" }).expect(400);
      }
      await request(app.getHttpServer()).post("/api/facebook/connect")
        .set("Host", "localhost:5173").set("Origin", "http://localhost:5173").expect(400);
      await request(app.getHttpServer()).post("/api/facebook/reports")
        .set("Host", "localhost:5173").set("Origin", "http://localhost:5173")
        .type("form").send({ businessId: "demo-guzman", pageId: "99" }).expect(400);
      expect(create).toHaveBeenCalledTimes(1);
      expect(graph.request).not.toHaveBeenCalled();
    } finally { create.mockRestore(); }
    await request(app.getHttpServer()).post("/api/facebook/reports")
      .set("Host", "localhost:5173").set("Origin", "http://localhost:5173")
      .send({ businessId: "demo-guzman", pageId: "99" }).expect(400);
    expect(graph.request).not.toHaveBeenCalled();
  });

  it("reads session-scoped report progress through the frontend proxy without provider calls", async () => {
    const id = "d".repeat(64);
    await store.save(id, { token: "private-browser-token", expiresAt: Date.now() + 60000, createdAt: new Date().toISOString() });
    const response = await request(app.getHttpServer()).get("/api/facebook/reports/status")
      .query({ businessId: "demo-guzman" }).set("Host", "localhost:5173")
      .set("Cookie", `seo_spy_facebook_test=${id}`).expect(200);
    expect(response.body).toEqual({ businessId: "demo-guzman", active: null, latest: null });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).not.toContain("private-browser-token");
    await request(app.getHttpServer()).get("/api/facebook/reports/status")
      .query({ businessId: "demo-guzman" }).set("Host", "localhost:5173").expect(400);
    await request(app.getHttpServer()).get("/api/facebook/reports/status")
      .query({ businessId: "demo-guzman" }).set("Host", "localhost:5173")
      .set("Origin", "https://attacker.invalid").set("Cookie", `seo_spy_facebook_test=${id}`).expect(400);
    await request(app.getHttpServer()).get("/api/facebook/reports/status")
      .query({ businessId: "demo-guzman" }).set("Host", "localhost:5174")
      .set("Cookie", `seo_spy_facebook_test=${id}`).expect(400);
    await request(app.getHttpServer()).get("/api/facebook/reports/status")
      .query({ businessId: "../invalid" }).set("Host", "localhost:5173")
      .set("Cookie", `seo_spy_facebook_test=${id}`).expect(400);
    expect(graph.request).not.toHaveBeenCalled();
  });

  it("accepts a same-origin report form and offers a download only after archiving browser-derived evidence", async () => {
    const id = "b".repeat(64);
    await store.save(id, {
      token: "browser-report-token",
      expiresAt: Date.now() + 60000,
      createdAt: new Date().toISOString(),
    });
    graph.request.mockImplementation(async (path, token, params) => {
      expect(token).not.toBe(USER_TOKEN);
      if (path === "me/permissions") return permissions();
      if (path === "me/accounts")
        return {
          data: [{ id: "99", name: "Report Page", access_token: PAGE_TOKEN }],
        };
      if (path === "99/posts") return { data: [] };
      if (path === "99/insights")
        return {
          data: [
            {
              name: params?.metric,
              period: "day",
              values: [{ value: 0, end_time: new Date().toISOString() }],
            },
          ],
        };
      return { id: "99" };
    });
    const write = jest
      .spyOn(app.get(FileReportStore), "write")
      .mockImplementation(async (audit, business) => {
        expect(business.id).toBe("demo-guzman");
        expect(audit.scope).toBe("facebook");
        expect(audit.results?.facebook?.pageId).toBe("99");
        expect(JSON.stringify(audit)).not.toContain("browser-report-token");
        expect(JSON.stringify(audit)).not.toContain(PAGE_TOKEN);
        return {
          reportId: audit.id,
          auditId: audit.id,
          generatedAt: new Date().toISOString(),
          fileName: "saved.json",
          downloadUrl: `/api/audits/${audit.id}/report`,
        };
      });
    try {
      const response = await request(app.getHttpServer())
        .post("/api/facebook/reports")
        .set("Host", "localhost:3001")
        .set("Origin", ORIGIN)
        .set("Cookie", `seo_spy_facebook_test=${id}`)
        .type("form")
        .send({ businessId: "demo-guzman", pageId: "99" })
        .expect(201);
      expect(response.type).toBe("text/html");
      expect(response.text).toContain("Download report JSON");
      expect(write).toHaveBeenCalledTimes(1);
      expect(response.text).not.toContain("browser-report-token");
      await request(app.getHttpServer())
        .post("/api/facebook/reports")
        .set("Host", "localhost:3001")
        .set("Origin", ORIGIN)
        .set("Cookie", `seo_spy_facebook_test=${id}`)
        .send({ businessId: "demo-guzman", pageId: "../other" })
        .expect(400);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });

  it("keeps diagnostics isolated by cookie, conceals credentials, and forgets a disconnected session", async () => {
    const status = await request(app.getHttpServer())
      .get("/api/facebook/status")
      .set("Host", "localhost:3001")
      .expect(200);
    expect(status.body).toMatchObject({
      accessTokenConfigured: true,
      appSecretConfigured: true,
      writesEnabled: false,
    });
    expect(status.text).not.toContain(USER_TOKEN);
    expect(status.text).not.toContain("private-app-secret");
    const connected = await request(app.getHttpServer())
      .post("/api/facebook/test-token")
      .set("Host", "localhost:3001")
      .set("Origin", ORIGIN)
      .expect(303);
    const cookies = connected.headers["set-cookie"] as unknown as string[];
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
    const cookie = cookies[0]!.split(";")[0]!;
    await request(app.getHttpServer())
      .get("/api/facebook/connection")
      .set("Host", "localhost:3001")
      .expect(400);
    const result = await request(app.getHttpServer())
      .get("/api/facebook/connection")
      .set("Host", "localhost:3001")
      .set("Cookie", cookie)
      .expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.requiredPermissionsGranted).toBe(true);
    expect(result.text).not.toContain(USER_TOKEN);
    await request(app.getHttpServer())
      .post("/api/facebook/disconnect")
      .set("Host", "localhost:3001")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie)
      .expect(303);
    await request(app.getHttpServer())
      .get("/api/facebook/connection")
      .set("Host", "localhost:3001")
      .set("Cookie", cookie)
      .expect(400);
  });
});
