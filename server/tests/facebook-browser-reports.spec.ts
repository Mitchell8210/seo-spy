import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import type { Audit, Business } from "../src/contracts/domain.js";
import { FacebookReportsService } from "../src/modules/facebook/facebook-reports.service.js";
import {
  FacebookGraph,
  FacebookService,
  FacebookError,
} from "../src/modules/facebook/facebook.service.js";
import type { BusinessRepository } from "../src/persistence/repositories.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import type { ReportFileReference } from "../src/reports/report.types.js";

class MockGraph extends FacebookGraph {
  override request = jest.fn<FacebookGraph["request"]>();
}
const business: Business = {
  id: "business-1",
  name: "Example",
  website: "https://example.com/",
  createdAt: "2026-10-29T00:00:00.000Z",
};
const reference: ReportFileReference = {
  reportId: "saved",
  auditId: "saved",
  generatedAt: "2026-10-29T00:00:00.000Z",
  fileName: "saved.json",
  downloadUrl: "/api/audits/saved/report",
};

function fixture() {
  const graph = new MockGraph(
    new ConfigService({ FACEBOOK_GRAPH_VERSION: "v26.0" }),
  );
  graph.request.mockImplementation(async (path, _token, params) => {
    if (path === "me/accounts")
      return {
        data: [
          { id: "123", name: "Example", access_token: "private-page-token" },
        ],
      };
    if (path === "123/posts") return { data: [] };
    if (path === "123/insights")
      return {
        data: [
          {
            name: params?.metric,
            period: "day",
            values: [{ value: 0, end_time: "2026-10-29T07:00:00Z" }],
          },
        ],
      };
    const field = params?.fields?.split(",")[1] ?? "";
    const values: Record<string, unknown> = {
      name: "Example",
      followers_count: 0,
      fan_count: 0,
      is_published: true,
      is_verified: false,
      overall_star_rating: 0,
      rating_count: 0,
      emails: [],
      location: { city: "Example" },
      hours: {},
    };
    return {
      id: "123",
      [field]: Object.hasOwn(values, field) ? values[field] : "Example",
    };
  });
  const write = jest
    .fn<(audit: Audit, business: Business) => Promise<ReportFileReference>>()
    .mockResolvedValue(reference);
  const reports = { write } as unknown as FileReportStore;
  const findById = jest
    .fn<BusinessRepository["findById"]>()
    .mockResolvedValue(business);
  const businesses: BusinessRepository = {
    findById,
    connections: async () => [],
  };
  const credential = jest
    .fn<
      (id?: string) => Promise<{
        token: string;
        expiresAt: number | null;
        createdAt: string;
      }>
    >()
    .mockResolvedValue({
      token: "private-user-token",
      expiresAt: Date.now() + 60000,
      createdAt: new Date().toISOString(),
    });
  const requirePermissions = jest
    .fn<(token: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const markReconnect = jest
    .fn<(id?: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const facebook = {
    credential,
    requirePermissions,
    markReconnect,
  } as unknown as FacebookService;
  const service = new FacebookReportsService(
    reports,
    businesses,
    graph,
    facebook,
  );
  return {
    service,
    graph,
    write,
    findById,
    credential,
    requirePermissions,
    markReconnect,
  };
}

describe("Facebook reports from browser authorization", () => {
  it("exposes running and terminal progress only to the initiating browser without Meta reads", async () => {
    const f = fixture();
    let release!: (value: ReportFileReference) => void;
    let entered!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    f.write.mockImplementation(async () => { entered(); return new Promise(resolve => { release = resolve; }); });
    const job = f.service.create("session", business.id, "123");
    await writing;
    const calls = f.graph.request.mock.calls.length;
    expect(await f.service.status("session", business.id)).toEqual({ businessId: business.id, active: { pageId: "123", status: "running" }, latest: null });
    expect(await f.service.status("another-session", business.id)).toEqual({ businessId: business.id, active: null, latest: null });
    expect(f.graph.request).toHaveBeenCalledTimes(calls);
    release(reference); await job;
    expect(await f.service.status("session", business.id)).toMatchObject({ active: null, latest: { pageId: "123", result: { auditId: "saved", status: "completed" }, error: null } });
    expect((await f.service.status("another-session", business.id)).latest).toBeNull();
    expect(f.graph.request).toHaveBeenCalledTimes(calls);
  });

  it("retains safe terminal failures and clears prior outcomes when another run starts", async () => {
    const f = fixture();
    f.requirePermissions.mockRejectedValueOnce(new Error("private provider details"));
    await expect(f.service.create("session", business.id, "123")).rejects.toThrow();
    const status = await f.service.status("session", business.id);
    expect(status).toMatchObject({ active: null, latest: { result: null, error: { code: "FACEBOOK_REPORT_FAILED" } } });
    expect(JSON.stringify(status)).not.toContain("private provider details");
    await f.service.create("session", business.id, "123");
    expect((await f.service.status("session", business.id)).latest?.error).toBeNull();
    f.credential.mockRejectedValueOnce(new Error("Reconnect required"));
    await expect(f.service.status(undefined, business.id)).rejects.toThrow("Reconnect");
    await expect(f.service.status("session", "../invalid")).rejects.toThrow("registered business");
  });

  it("collects with the browser user token and returns only after the archive write completes", async () => {
    const f = fixture();
    let release!: (reference: ReportFileReference) => void;
    let writing!: () => void;
    const enteredWrite = new Promise<void>((resolve) => {
      writing = resolve;
    });
    f.write.mockImplementation(async () => {
      writing();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    let settled = false;
    const request = f.service
      .create("session", business.id, "123")
      .then((value) => {
        settled = true;
        return value;
      });
    await enteredWrite;
    expect(settled).toBe(false);
    expect(f.credential).toHaveBeenCalledWith("session");
    expect(f.requirePermissions).toHaveBeenCalledWith("private-user-token");
    expect(f.graph.request).toHaveBeenCalledWith(
      "me/accounts",
      "private-user-token",
      expect.any(Object),
      true,
      expect.any(AbortSignal),
    );
    const [audit, archivedBusiness] = f.write.mock.calls[0]!;
    expect(archivedBusiness).toEqual(business);
    expect(audit).toMatchObject({
      scope: "facebook",
      mode: "live",
      status: "completed",
      businessId: business.id,
      results: {
        facebook: { pageId: "123", profile: { followers_count: { value: 0 } } },
      },
    });
    expect(JSON.stringify(audit)).not.toContain("private-user-token");
    expect(JSON.stringify(audit)).not.toContain("private-page-token");
    release(reference);
    await expect(request).resolves.toEqual({
      ...reference,
      status: "completed",
      failure: null,
    });
  });

  it("rejects missing sessions and unknown businesses before contacting the provider", async () => {
    const f = fixture();
    f.credential.mockRejectedValueOnce(new Error("Reconnect required"));
    await expect(
      f.service.create(undefined, business.id, "123"),
    ).rejects.toThrow("Reconnect");
    f.findById.mockResolvedValueOnce(null);
    await expect(f.service.create("session", "missing", "123")).rejects.toThrow(
      "Business not found",
    );
    expect(f.graph.request).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("rejects malformed target selection and missing permissions before collecting", async () => {
    const f = fixture();
    await expect(
      f.service.create("session", "../business", "123"),
    ).rejects.toThrow();
    await expect(
      f.service.create("session", business.id, "123/other"),
    ).rejects.toThrow();
    f.requirePermissions.mockRejectedValue(new Error("Missing permissions"));
    await expect(
      f.service.create("session", business.id, "123"),
    ).rejects.toThrow("Missing permissions");
    expect(f.graph.request).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("blocks concurrent collection for a business and releases the lock after failure", async () => {
    const f = fixture();
    let release!: () => void;
    f.credential.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error("Session unavailable");
    });
    const first = f.service.create("session", business.id, "123");
    await Promise.resolve();
    await expect(
      f.service.create("session", business.id, "123"),
    ).rejects.toThrow("already being generated");
    release();
    await expect(first).rejects.toThrow("Session unavailable");
    await expect(
      f.service.create("session", business.id, "123"),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("archives partial usable evidence and failed authorization without leaking provider details", async () => {
    const f = fixture();
    const original = f.graph.request.getMockImplementation()!;
    f.graph.request.mockImplementation(async (...args) => {
      if (args[2]?.metric === "page_media_view")
        throw new FacebookError("PROVIDER_REJECTED", 100);
      return original(...args);
    });
    await expect(
      f.service.create("session", business.id, "123"),
    ).resolves.toMatchObject({ status: "partial" });
    expect(
      f.write.mock.calls[0]?.[0].results?.facebook?.metrics.find(
        (metric) => metric.name === "page_media_view",
      )?.status,
    ).toBe("unavailable");
    f.graph.request.mockRejectedValue(
      new FacebookError("PROVIDER_REJECTED", 190),
    );
    await expect(
      f.service.create("session", business.id, "123"),
    ).resolves.toMatchObject({
      status: "failed",
      failure: { code: "FACEBOOK_AUTHORIZATION_FAILED" },
    });
    expect(f.markReconnect).not.toHaveBeenCalled();
    expect(f.write.mock.calls[1]?.[0].results).toBeNull();
  });

  it("never advertises an archive when saving fails", async () => {
    const f = fixture();
    f.write.mockRejectedValue(new Error("private filesystem details"));
    await expect(
      f.service.create("session", business.id, "123"),
    ).rejects.toThrow("could not be saved");
  });

  it("requests reconnect only for a definite Meta token invalidation during permission validation", async () => {
    const f = fixture();
    f.requirePermissions.mockRejectedValue(
      new FacebookError("PROVIDER_REJECTED", 190),
    );
    await expect(
      f.service.create("session", business.id, "123"),
    ).rejects.toThrow("Reconnect Facebook");
    expect(f.markReconnect).toHaveBeenCalledWith("session");
    expect(f.graph.request).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("aborts collection and settles outstanding jobs during shutdown", async () => {
    const f = fixture();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.graph.request.mockImplementation(
      async (_path, _token, _params, _proof, signal) => {
        entered();
        return new Promise((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () => reject(new Error("Aborted")),
            { once: true },
          );
        });
      },
    );
    const request = f.service.create("session", business.id, "123");
    await ready;
    await f.service.onModuleDestroy();
    await expect(request).resolves.toMatchObject({
      status: "failed",
      failure: { code: "SERVER_STOPPING" },
    });
    await expect(
      f.service.create("session", business.id, "123"),
    ).rejects.toThrow("server is stopping");
  });
});
