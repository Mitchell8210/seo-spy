import type { Evidence } from "../src/contracts/domain.js";
import { analyzeFacebook } from "../src/integrations/facebook/analyze.js";
import type {
  FacebookMetric,
  FacebookReport,
} from "../src/integrations/facebook/types.js";

const auditId = "audit-analysis";
const at = "2026-10-29T16:00:00.000Z";
const evidence = [
  "facebook:posts",
  "facebook:profile:phone",
  "facebook:profile:hours",
].map((checkId, index): Evidence => ({
  id: `evidence-${index}`,
  auditId,
  checkId,
  sourceUrl: "https://www.facebook.com/123",
  collectedAt: at,
  observed: {},
  mode: "live",
}));
function metric(
  name: string,
  values: number[],
  aggregation: "sum" | "snapshot" = "sum",
): FacebookMetric {
  return {
    name,
    status: "available",
    period: "day",
    points: values.map((value, i) => ({
      endTime: `2026-10-${String(25 + i).padStart(2, "0")}T07:00:00.000Z`,
      value,
    })),
    aggregation,
    total: aggregation === "sum" ? values.reduce((a, b) => a + b, 0) : null,
    collectedAt: at,
  };
}
function report(): FacebookReport {
  return {
    provider: "facebook-graph",
    version: "facebook-v1",
    graphVersion: "v26.0",
    pageId: "123",
    pageName: "Example",
    collectedAt: at,
    window: { since: "2026-09-29T16:00:00Z", until: at, requestedDays: 30 },
    profile: {
      phone: { status: "available", value: "(702) 340-6758", collectedAt: at },
      hours: { status: "missing", value: null, collectedAt: at },
    },
    posts: {
      status: "available",
      items: [
        {
          id: "123_456",
          message: "Call (725) 340-6758",
          createdTime: "2026-08-19T20:23:18.000Z",
          url: "https://www.facebook.com/123_456",
        },
      ],
      truncated: true,
      collectedAt: at,
    },
    metrics: [
      metric("page_follows", [15, 15], "snapshot"),
      metric("page_media_view", [3, 4]),
      metric("page_post_engagements", [0, 0]),
    ],
    summary: {
      followersStart: 15,
      followersEnd: 15,
      followersChange: 0,
      latestPostAt: null,
      postsInWindow: 0,
      postsInWindowComplete: false,
    },
    coverage: {
      profileFieldsAvailable: 1,
      profileFieldsMissing: 1,
      profileFieldsUnavailable: 0,
      metricsAvailable: 3,
      metricsRequested: 7,
      postsLimit: 50,
    },
    limitations: [],
  };
}

describe("Derived Facebook report analysis", () => {
  it("identifies old collected posts even when history is truncated and creates stable evidence-linked reviews", () => {
    const source = report();
    const original = JSON.stringify(source);
    const analysis = analyzeFacebook(source, auditId, evidence);
    expect(analysis).toEqual(analyzeFacebook(source, auditId, evidence));
    expect(JSON.stringify(source)).toBe(original);
    const inactivity = analysis.findings.find(
      (item) => item.checkId === "facebook:posting-inactivity",
    );
    expect(inactivity?.explanation).toContain("70 days before collection");
    expect(inactivity?.explanation).toContain("collected posts");
    expect(analysis.summaries).toContain(
      "Post collection is limited; this report is not a complete publishing history.",
    );
    for (const finding of analysis.findings) {
      expect(finding.evidenceIds.length).toBeGreaterThan(0);
      expect(
        finding.evidenceIds.every((id) =>
          evidence.some((item) => item.id === id),
        ),
      ).toBe(true);
    }
    for (const recommendation of analysis.recommendations)
      expect(
        analysis.findings.some((item) => item.id === recommendation.findingId),
      ).toBe(true);
  });

  it("flags different phone numbers without choosing a correct number and preserves the historical caveat", () => {
    const analysis = analyzeFacebook(report(), auditId, evidence);
    const phone = analysis.findings.find(
      (item) => item.checkId === "facebook:phone-consistency",
    );
    expect(phone?.evidenceIds).toEqual(["evidence-0", "evidence-1"]);
    expect(phone?.explanation).toContain("(702) 340-6758");
    expect(phone?.explanation).toContain("(725) 340-6758");
    expect(phone?.explanation).toContain("123_456 (2026-08-19)");
    expect(phone?.explanation).toContain(
      "does not determine which number is correct",
    );
  });

  it("normalizes US country prefixes and formatting and excludes arbitrary numeric identifiers", () => {
    const source = report();
    source.profile.phone!.value = "+1 7023406758";
    source.posts.items[0]!.message =
      "Call +1 (702) 340-6758 or 702.340.6758. ID 7253406758, ID 123725340675899";
    expect(
      analyzeFacebook(source, auditId, evidence).findings.some(
        (item) => item.checkId === "facebook:phone-consistency",
      ),
    ).toBe(false);
  });

  it("detects differing post contact numbers when the profile phone is unavailable", () => {
    const source = report();
    source.profile.phone = {
      status: "unavailable",
      value: null,
      collectedAt: at,
    };
    source.posts.items[0]!.message = "Call (702) 340-6758 or (725) 340-6758";
    expect(
      analyzeFacebook(source, auditId, evidence).findings.find(
        (item) => item.checkId === "facebook:phone-consistency",
      )?.evidenceIds,
    ).toEqual(["evidence-0"]);
  });

  it("retains measured zero, sums additive metrics only and uses follower snapshots rather than their sum", () => {
    const source = report();
    source.metrics[0]!.total = 30; // Untrusted/precomputed total must not be used for follower history.
    source.metrics.push({
      ...metric("page_views_total", []),
      status: "unavailable",
      total: null,
    });
    const summaries = analyzeFacebook(source, auditId, evidence).summaries.join(
      "\n",
    );
    expect(summaries).toContain("from 15 (2026-10-25) to 15 (2026-10-26): +0");
    expect(summaries).toContain(
      "Media views: 7 across 2 returned daily measurements.",
    );
    expect(summaries).toContain(
      "Post engagements: 0 across 2 returned daily measurements.",
    );
    expect(summaries).toContain("Page views: unavailable");
    expect(summaries).toContain("latest period may be incomplete");
  });

  it.each(["unavailable", "missing", "future", "unknown"] as const)(
    "does not infer inactivity from %s post data",
    (kind) => {
      const source = report();
      if (kind === "unavailable" || kind === "missing")
        source.posts.status = kind;
      if (kind === "future")
        source.posts.items[0]!.createdTime = "2026-11-01T00:00:00Z";
      if (kind === "unknown") source.posts.items[0]!.createdTime = null;
      expect(
        analyzeFacebook(source, auditId, evidence).findings.some(
          (item) => item.checkId === "facebook:posting-inactivity",
        ),
      ).toBe(false);
    },
  );

  it("does not treat unavailable fields as missing or create findings without matching live audit evidence", () => {
    const source = report();
    source.profile.hours = {
      status: "unavailable",
      value: null,
      collectedAt: at,
    };
    expect(
      analyzeFacebook(source, auditId, evidence).findings.some(
        (item) => item.checkId === "facebook:profile:hours",
      ),
    ).toBe(false);
    expect(analyzeFacebook(source, auditId, []).findings).toEqual([]);
    expect(
      analyzeFacebook(
        source,
        auditId,
        evidence.map((item) => ({ ...item, auditId: "another-audit" })),
      ).findings,
    ).toEqual([]);
  });
});
