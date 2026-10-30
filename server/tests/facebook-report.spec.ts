import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import {
  FacebookGraph,
  FacebookError,
} from "../src/modules/facebook/facebook.service.js";
import { collectFacebookReport } from "../src/integrations/facebook/collect.js";

class MockGraph extends FacebookGraph {
  override request = jest.fn<FacebookGraph["request"]>();
}
function fixture() {
  const graph = new MockGraph(
    new ConfigService({ FACEBOOK_GRAPH_VERSION: "v26.0" }),
  );
  graph.request.mockImplementation(async (path, _token, params) => {
    if (path === "me/accounts")
      return {
        data: [
          {
            id: "123",
            name: "Test business",
            access_token: "private-page-token",
          },
        ],
      };
    if (path === "123/posts")
      return {
        data: [
          {
            id: "123_456",
            message: "<script>untrusted</script>",
            created_time: new Date().toISOString(),
            access_token: "private-page-token",
          },
        ],
      };
    if (path === "123/insights")
      return {
        data: [
          {
            name: params?.metric,
            period: "day",
            values: [
              {
                value: params?.metric === "page_follows" ? 12 : 0,
                end_time: "2026-10-01T07:00:00Z",
              },
              {
                value: params?.metric === "page_follows" ? 15 : 0,
                end_time: "2026-10-02T07:00:00Z",
              },
            ],
          },
        ],
      };
    const field = params?.fields?.split(",")[1] ?? "";
    const values: Record<string, unknown> = {
      name: "Test business",
      followers_count: 15,
      fan_count: 12,
      is_published: true,
      is_verified: false,
      overall_star_rating: 0,
      rating_count: 0,
      emails: [],
      location: { city: "Example", access_token: "private-page-token" },
      hours: {},
    };
    return {
      id: "123",
      [field]: Object.hasOwn(values, field) ? values[field] : "Example",
      access_token: "private-page-token",
    };
  });
  return graph;
}

describe("Facebook saved report collector", () => {
  it("retains evidence with zero measurements, snapshot deltas and sanitized profile/posts", async () => {
    const graph = fixture();
    const { results, partial } = await collectFacebookReport(
      graph,
      "private-user-token",
      "123",
      "audit-1",
    );
    expect(partial).toBe(false);
    expect(results.facebook?.summary).toMatchObject({
      followersStart: 12,
      followersEnd: 15,
      followersChange: 3,
    });
    expect(
      results.facebook?.metrics.find(
        (metric) => metric.name === "page_follows",
      ),
    ).toMatchObject({ total: null, aggregation: "snapshot" });
    expect(
      results.facebook?.metrics.find(
        (metric) => metric.name === "page_media_view",
      ),
    ).toMatchObject({ total: 0, status: "available" });
    expect(results.facebook?.profile.hours).toMatchObject({
      status: "missing",
      value: {},
    });
    expect(results.facebook?.profile.is_verified).toMatchObject({
      status: "available",
      value: false,
    });
    expect(results.facebook?.posts.items[0]?.message).toBe(
      "<script>untrusted</script>",
    );
    expect(JSON.stringify(results)).not.toContain("private-page-token");
    expect(JSON.stringify(results)).not.toContain("private-user-token");
    expect(JSON.stringify(results)).not.toContain("access_token");
    expect(results.evidence.every((item) => item.auditId === "audit-1")).toBe(
      true,
    );
    expect(results.scores.every((score) => score.value === null)).toBe(true);
    expect(results.findings.length).toBeGreaterThan(0);
    for (const finding of results.findings)
      expect(
        results.evidence.some((item) => finding.evidenceIds.includes(item.id)),
      ).toBe(true);
    for (const recommendation of results.recommendations)
      expect(
        results.findings.some(
          (finding) => finding.id === recommendation.findingId,
        ),
      ).toBe(true);
  });

  it("rejects a Page outside the authorized list without probing it", async () => {
    const graph = fixture();
    await expect(
      collectFacebookReport(graph, "private-user-token", "999", "audit"),
    ).rejects.toMatchObject({ code: "FACEBOOK_PAGE_NOT_AUTHORIZED" });
    expect(graph.request).toHaveBeenCalledTimes(1);
  });

  it("retains useful data when profile reads and metrics fail without turning failures into missing-field advice", async () => {
    const graph = fixture();
    const original = graph.request.getMockImplementation()!;
    graph.request.mockImplementation(async (...args) => {
      if (
        args[2]?.fields === "id,phone" ||
        args[2]?.metric === "page_media_view"
      )
        throw new FacebookError("PROVIDER_REJECTED", 100);
      return original(...args);
    });
    const result = await collectFacebookReport(
      graph,
      "private-user-token",
      "123",
      "audit",
    );
    expect(result.partial).toBe(true);
    expect(result.results.facebook?.profile.phone.status).toBe("unavailable");
    expect(
      result.results.findings.some(
        (finding) => finding.checkId === "facebook:profile:phone",
      ),
    ).toBe(false);
    expect(
      result.results.facebook?.metrics.find(
        (metric) => metric.name === "page_media_view",
      ),
    ).toMatchObject({ status: "unavailable", total: null, points: [] });
    expect(result.results.facebook?.posts.items).toHaveLength(1);
  });

  it("bounds post pagination and does not follow arbitrary next URLs or infer a complete posting history", async () => {
    const graph = fixture();
    const original = graph.request.getMockImplementation()!;
    let batch = 0;
    graph.request.mockImplementation(async (...args) => {
      if (args[0] === "123/posts") {
        batch++;
        return {
          data: Array.from({ length: 25 }, (_, i) => ({
            id: `123_${batch * 100 + i}`,
            created_time: "2020-01-01T00:00:00Z",
          })),
          paging: {
            next: "https://attacker.invalid/?access_token=private-page-token",
            cursors: { after: `cursor-${batch}` },
          },
        };
      }
      return original(...args);
    });
    const result = await collectFacebookReport(
      graph,
      "private-user-token",
      "123",
      "audit",
    );
    expect(batch).toBe(2);
    expect(result.results.facebook?.posts.items).toHaveLength(50);
    expect(result.results.facebook?.posts.truncated).toBe(true);
    expect(result.results.facebook?.summary.postsInWindowComplete).toBe(false);
    expect(
      result.results.findings.some(
        (finding) => finding.checkId === "facebook:posts",
      ),
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain("attacker.invalid");
    expect(
      graph.request.mock.calls.every((call) => !call[0].startsWith("https:")),
    ).toBe(true);
  });

  it("makes no requests after an initial cancellation", async () => {
    const graph = fixture();
    await expect(
      collectFacebookReport(
        graph,
        "private-user-token",
        "123",
        "audit",
        AbortSignal.abort(),
      ),
    ).rejects.toThrow();
    expect(graph.request).not.toHaveBeenCalled();
  });
});
