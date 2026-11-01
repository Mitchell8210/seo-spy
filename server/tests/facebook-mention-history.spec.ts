import "reflect-metadata";
import { jest } from "@jest/globals";
import { probeFacebookMentionHistory, probeFacebookMentionFeedHistory } from "../src/integrations/facebook/mention-history.js";
import { FacebookError } from "../src/modules/facebook/facebook.service.js";

type Request = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
const now = new Date("2026-11-01T18:00:00Z");

it("finishes a feed-only search beyond the original 75-record bound without rescanning comments", async () => {
  let batch = 0;
  const request = jest.fn<Request>().mockImplementation(async (path, params) => {
    expect(path).toBe("99/feed");
    batch++;
    expect(params.after).toBe(batch === 1 ? undefined : String(batch - 1));
    return { data: [{ id: `99_${batch}` }], ...(batch < 4 ? { paging: { next: "https://private.invalid", cursors: { after: String(batch) } } } : {}) };
  });
  const result = await probeFacebookMentionFeedHistory(request, "99", now);
  expect(result).toMatchObject({ feedRecordsScanned: 4, feedListingComplete: true, requestsMade: 4,
    postsScanned: 0, commentsScanned: 0, boundReached: false, positiveControlFound: false, uniquePeopleMentioningBusiness: null });
  expect(JSON.stringify(result)).not.toContain("private.invalid");
});
const old = "2026-06-01T12:00:00Z";
const current = "2026-10-30T12:00:00Z";

describe("Bounded historical Facebook mention search", () => {
  it("finds an old exact Page-ID mention and checks its direct record without exposing people or text", async () => {
    const control = { id: "77777777_1", created_time: old, message_tags: { "0": [{ id: "99", name: "Private tag name" }] },
      from: { id: "77777777", name: "Private author" }, message: "private message text" };
    const request = jest.fn<Request>().mockImplementation(async (path, params) => {
      expect(params.since).toBeUndefined(); expect(params.until).toBeUndefined();
      if (path === control.id) return control;
      return { data: [control], paging: { next: "https://private.invalid/token", cursors: { after: "secret-cursor" } } };
    });
    const result = await probeFacebookMentionHistory(request, "99", now);
    expect(result).toMatchObject({ positiveControlFound: true, directControlVerified: true, controlSource: "tagged",
      controlIn30DayWindow: false, authorIdAvailable: true, authorTypeEstablished: false, uniquePeopleMentioningBusiness: null, requestsMade: 2 });
    expect(JSON.stringify(result)).not.toMatch(/77777777|Private author|Private tag name|private message text|private.invalid|secret-cursor/);
    expect(request.mock.calls.every(([, params]) => !params.fields.split(",").includes("message"))).toBe(true);
  });

  it("ignores plain text and self mentions, and locates an explicit comment tag on an old post", async () => {
    const control = { id: "99_1_1", created_time: current, message_tags: [{ id: "99" }], from: null };
    const request = jest.fn<Request>().mockImplementation(async path => {
      if (path === "99/tagged") return { data: [{ id: "99_5", message_tags: [{ id: "99" }], from: { id: "99" } },
        { id: "88_1", message: "Guzman Tax Accounting", message_tags: [{ id: "88" }] }] };
      if (path === "99/feed") return { data: [] };
      if (path === "99/posts") return { data: [{ id: "99_1", comments: { data: [control] } }] };
      if (path === control.id) return control;
      throw new Error("Unexpected request");
    });
    const result = await probeFacebookMentionHistory(request, "99", now);
    expect(result).toMatchObject({ positiveControlFound: true, directControlVerified: true, controlSource: "comment",
      controlIn30DayWindow: true, authorIdAvailable: false, selfAuthoredMentionsExcluded: 1, postsScanned: 1, commentsScanned: 1 });
    expect(JSON.stringify(result)).not.toContain("Guzman Tax Accounting");
  });

  it("follows only cursors, verifies omitted comment edges directly and reports exhaustive visible coverage without zero people", async () => {
    const request = jest.fn<Request>().mockImplementation(async (path, params) => {
      if (path === "99/posts" && !params.after) return { data: [{ id: "99_1", comments: { data: [] } }],
        paging: { next: "https://attacker.invalid", cursors: { after: "safe-cursor" } } };
      if (path === "99/posts") { expect(params.after).toBe("safe-cursor"); return { data: [{ id: "99_2" }] }; }
      return { data: [] };
    });
    const result = await probeFacebookMentionHistory(request, "99", now);
    expect(result).toMatchObject({ positiveControlFound: false, directControlVerified: false, postsScanned: 2,
      postListingComplete: true, commentStreamsComplete: true, taggedListingComplete: true, feedListingComplete: true,
      uniquePeopleMentioningBusiness: null, errorCode: null });
    expect(request.mock.calls.some(([path]) => path === "99_2/comments")).toBe(true);
    expect(request.mock.calls.every(([path]) => !path.includes("://"))).toBe(true);
  });

  it("preserves provider failures and mismatched direct controls without leaking raw errors", async () => {
    const request = jest.fn<Request>().mockRejectedValue(new FacebookError("PROVIDER_REJECTED", 100, 33));
    const result = await probeFacebookMentionHistory(request, "99", now);
    expect(result).toMatchObject({ errorCode: "PROVIDER_REJECTED", providerCode: 100, providerSubcode: 33, requestsMade: 1, uniquePeopleMentioningBusiness: null });
    const control = { id: "88_1", created_time: old, message_tags: [{ id: "99" }] };
    request.mockImplementation(async path => path === control.id ? { id: "88_2", message_tags: [{ id: "99" }] } : { data: [control] });
    expect(await probeFacebookMentionHistory(request, "99", now)).toMatchObject({ positiveControlFound: true,
      directControlVerified: false, errorCode: "MENTION_CONTROL_TARGET_MISMATCH" });
  });

  it("rejects wrong Page targets, malformed timestamps and repeated paging cursors", async () => {
    const request = jest.fn<Request>().mockResolvedValue({ data: [] });
    await expect(probeFacebookMentionHistory(request, "../me", now)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    for (const raw of [
      { data: [{ id: "88_1", comments: { data: [] } }] },
      { data: [{ id: "99_1", comments: { data: [{ id: "99_1_1", created_time: "invalid" }] } }] },
    ]) {
      request.mockImplementation(async path => path === "99/posts" ? raw : { data: [] });
      const result = await probeFacebookMentionHistory(request, "99", now);
      expect(result.errorCode).not.toBeNull();
      expect(result.directControlVerified).toBe(false);
    }
    request.mockImplementation(async () => ({ data: [], paging: { next: "https://attacker.invalid", cursors: { after: "same" } } }));
    expect(await probeFacebookMentionHistory(request, "99", now)).toMatchObject({ errorCode: "INCOMPLETE_MENTION_PAGING" });
  });

  it("bounds historical Page posts at 250 and never claims exhausted coverage after the cap", async () => {
    let batch = 0;
    const request = jest.fn<Request>().mockImplementation(async path => {
      if (path !== "99/posts") return { data: [] };
      batch++;
      return { data: Array.from({ length: 25 }, (_, index) => ({ id: `99_${batch * 100 + index}`, comments: { data: [] } })),
        paging: { next: "https://attacker.invalid", cursors: { after: String(batch) } } };
    });
    const result = await probeFacebookMentionHistory(request, "99", now);
    expect(result).toMatchObject({ postsScanned: 250, requestsMade: 12, boundReached: true, postListingComplete: false,
      commentStreamsComplete: false, positiveControlFound: false, uniquePeopleMentioningBusiness: null });
    expect(batch).toBe(10);
  });

  it("bounds direct comment paging and the combined request budget", async () => {
    let pageBatch = 0, commentId = 0;
    const request = jest.fn<Request>().mockImplementation(async path => {
      if (path === "99/tagged" || path === "99/feed") return { data: [] };
      if (path === "99/posts") {
        pageBatch++;
        return { data: Array.from({ length: 25 }, (_, index) => ({ id: `99_${pageBatch * 100 + index}` })),
          paging: { next: "https://attacker.invalid", cursors: { after: String(pageBatch) } } };
      }
      commentId++;
      return { data: [{ id: String(commentId), created_time: old }],
        paging: { next: "https://attacker.invalid", cursors: { after: String(commentId) } } };
    });
    const result = await probeFacebookMentionHistory(request, "99", now);
    expect(result).toMatchObject({ requestsMade: 150, boundReached: true, postListingComplete: false,
      commentStreamsComplete: false, errorCode: "MENTION_REQUEST_LIMIT", uniquePeopleMentioningBusiness: null });
    expect(request).toHaveBeenCalledTimes(150);
    // Three comment reads per fully scanned post, then move on without retries.
    const first = request.mock.calls.filter(([path]) => path === "99_100/comments");
    expect(first).toHaveLength(3);
  });
});
