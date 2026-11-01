import "reflect-metadata";
import { jest } from "@jest/globals";
import { probeFacebookShares } from "../src/integrations/facebook/share-probes.js";
import { FacebookError } from "../src/modules/facebook/facebook.service.js";

describe("Explicit read-only Facebook share probes", () => {
  it("keeps known lifetime shares distinct from empty sharedposts and an unknown period total", async () => {
    const request = jest.fn(async (path: string): Promise<Record<string, unknown>> => {
      if (path === "99/posts") return { data: [{ id: "99_1" }, { id: "99_2" }], paging: { next: "https://secret.invalid" } };
      if (path === "99_1") return { id: path, shares: { count: 9 } };
      if (path === "99_2") return { id: path };
      return { data: [] };
    });
    const result = await probeFacebookShares(request, "99");
    expect(result.complete30DayShareCount).toBeNull();
    expect(result.probes.find(item => item.label === "Post 99_1: lifetime share field")).toMatchObject({ data: { count: 9, omitted: false } });
    expect(result.probes.find(item => item.label === "Post 99_2: lifetime share field")).toMatchObject({ data: { count: null, omitted: true } });
    expect(result.probes.find(item => item.label === "Post 99_1: sharedposts timestamps")).toMatchObject({ data: { returnedSharePosts: 0, complete30DayShareCount: null } });
    expect(request).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(result)).not.toContain("secret.invalid");
  });

  it("filters returned timestamps to the exact completed window and excludes identities and content", async () => {
    const request = jest.fn(async (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
      if (path === "99/posts") return { data: [{ id: "99_1" }] };
      if (path === "99_1") return { id: path, shares: { count: 3 } };
      expect(params.fields === "id" || params.fields === "id,created_time").toBe(true);
      return { data: [
        { id: "sensitive-shared-post", created_time: "2026-10-02T07:00:00Z", message: "private text", from: { name: "Private person" } },
        { id: "another-shared-post", created_time: "2026-11-01T07:00:00Z" },
        { id: "no-timestamp" },
      ] };
    });
    const result = await probeFacebookShares(request, "99", new Date("2026-11-01T17:00:00Z"));
    expect(result.probes.at(-1)).toMatchObject({ data: { returnedSharePosts: 3, timestampedSharePosts: 2, observedSharePostsInWindow: 1, complete30DayShareCount: null } });
    expect(JSON.stringify(result)).not.toMatch(/sensitive-shared-post|private text|Private person|another-shared-post|no-timestamp/);
    expect(result.complete30DayShareCount).toBeNull();
  });

  it("isolates rejected edge reads and returns only safe error codes", async () => {
    const request = jest.fn(async (path: string): Promise<Record<string, unknown>> => {
      if (path === "99/posts") return { data: [{ id: "99_1" }] };
      if (path === "99_1") throw new Error("private credential");
      throw new FacebookError("PROVIDER_REJECTED", 200);
    });
    const result = await probeFacebookShares(request, "99");
    expect(result.probes.slice(1).map(item => item.status)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(result.probes.at(-1)).toMatchObject({ providerCode: 200 });
    expect(JSON.stringify(result)).not.toContain("private credential");
  });

  it("blocks arbitrary paths and wrong-Page post IDs before probing", async () => {
    const request = jest.fn(async () => ({ data: [{ id: "88_1" }] }));
    await expect(probeFacebookShares(request, "../me")).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const result = await probeFacebookShares(request, "99");
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.probes[0]).toMatchObject({ status: "unavailable", code: "INVALID_RESPONSE" });
  });
});
