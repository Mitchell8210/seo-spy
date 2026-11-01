import "reflect-metadata";
import { jest } from "@jest/globals";
import { CONTACT_METRIC_CANDIDATES, probeFacebookContactMetrics } from "../src/integrations/facebook/metric-probes.js";
import { FacebookError } from "../src/modules/facebook/facebook.service.js";

describe("Explicit Facebook contact metric probes", () => {
  it("isolates rejected metrics, retains true zero, counts LIKE only and strips private data", async () => {
    const request = jest.fn(async (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
      if (path.endsWith("/insights")) {
        if (params.metric !== "page_post_engagements") throw new FacebookError("PROVIDER_REJECTED", 100);
        return { data: [{ name: params.metric, period: "day", values: [{ value: 0 }] }] };
      }
      if (path === "99/posts") return { data: [{ id: "99_1", message: "private text" }], paging: { next: "https://private.invalid/token" } };
      if (path === "99_1/reactions") {
        expect(params).toEqual({ type: "LIKE", limit: "0", summary: "true" });
        return { summary: { total_count: 2 }, data: [{ id: "person", name: "Private person" }] };
      }
      if (path === "99_1/comments") return { summary: { total_count: 0 }, data: [{ message: "private comment" }] };
      if (path === "99_1") return { id: "99_1" }; // Omission is not zero.
      if (path === "99/conversations") return { data: [{ id: "private-conversation" }], paging: { next: "https://secret.invalid" } };
      return { data: [] };
    });
    const result = await probeFacebookContactMetrics(request, "99", new Date("2026-11-01T00:00:00Z"));
    expect(request).toHaveBeenCalledTimes(CONTACT_METRIC_CANDIDATES.length + 7);
    expect(result.probes[0]).toMatchObject({ status: "available", data: [{ values: [{ value: 0 }] }] });
    expect(result.probes[1]).toMatchObject({ status: "unavailable", providerCode: 100 });
    expect(result.probes.find(p => p.label.endsWith(": shares"))).toMatchObject({ data: { count: null, omitted: true } });
    expect(result.probes.find(p => p.label === "Messenger conversation metadata")).toMatchObject({ data: { returnedConversations: 1, messageCount: null } });
    expect(JSON.stringify(result)).not.toMatch(/private|Private|secret\.invalid/);
  });

  it("rejects wrong-Page posts, invalid values and unsafe error messages without probing their IDs", async () => {
    const request = jest.fn(async (path: string): Promise<Record<string, unknown>> => {
      if (path === "99/posts") return { data: [{ id: "88_1" }] };
      if (path.endsWith("/insights")) return { data: [{ name: "wrong_metric", period: "day", values: [{ value: -1 }] }] };
      throw new Error("private credential in an error");
    });
    const result = await probeFacebookContactMetrics(request, "99");
    expect(result.probes.every(p => p.status === "unavailable")).toBe(true);
    expect(request.mock.calls.some(([path]) => path.startsWith("88"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private credential");
  });

  it("distinguishes an empty insight response and rejects arbitrary Page paths before requests", async () => {
    const request = jest.fn(async () => ({ data: [] }));
    await expect(probeFacebookContactMetrics(request, "../me")).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const result = await probeFacebookContactMetrics(request, "99");
    expect(result.probes[0]).toMatchObject({ status: "empty", data: [] });
  });
});
