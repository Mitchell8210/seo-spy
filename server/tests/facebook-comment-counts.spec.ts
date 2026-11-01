import { jest } from "@jest/globals";
import { collectFacebookCommentCounts, type FacebookCommentRequest } from "../src/integrations/facebook/comment-counts.js";
import { createFacebookReportingWindow } from "../src/integrations/facebook/reporting-window.js";

const window = createFacebookReportingWindow(new Date("2026-11-01T17:00:00Z"));
const posts = { status: "available" as const, items: [{ id: "99_1" }, { id: "99_2" }], truncated: false };
const onePost = { ...posts, items: [posts.items[0]!] };
const comment = (id: string, created_time = "2026-10-30T12:00:00Z") => ({ id, created_time });

describe("Facebook reporting-window comment counts", () => {
  it("includes comments on older posts and replies, filters timestamps, paginates via cursors and excludes private content", async () => {
    const request = jest.fn<FacebookCommentRequest>().mockImplementation(async (path, params) => {
      expect(params).toMatchObject({ fields: "id,created_time", filter: "stream", order: "chronological", since: String(Date.parse(window.since) / 1000), limit: "100" });
      if (path === "99_2/comments") return { data: [comment("4", "2026-11-01T07:00:00Z")] };
      if (params.after === "safe-cursor") return { data: [comment("3", "2026-10-02T07:00:00+0000")] };
      return { data: [
        { ...comment("1"), message: "private content", from: { name: "Private person" } },
        comment("2", "2026-10-02T06:59:59Z"),
      ], paging: { next: "https://attacker.invalid/private-token", cursors: { after: "safe-cursor" } } };
    });
    const result = await collectFacebookCommentCounts(request, "99", posts, window);
    expect(result).toMatchObject({ status: "available", total: 2, observedTotal: 2, complete: true, postsCollected: 2, postsChecked: 2 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1]![1].after).toBe("safe-cursor");
    expect(JSON.stringify(result)).not.toMatch(/private|Private|attacker/);
  });

  it("returns a measured zero only after exhausting a complete visible post listing", async () => {
    const request = jest.fn<FacebookCommentRequest>().mockResolvedValue({ data: [] });
    expect(await collectFacebookCommentCounts(request, "99", posts, window)).toMatchObject({ status: "available", total: 0, complete: true, postsChecked: 2 });
    request.mockClear();
    expect(await collectFacebookCommentCounts(request, "99", { ...posts, items: [] }, window)).toMatchObject({ total: 0, complete: true, postsChecked: 0 });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed before collection for failed, duplicate or wrong-target posts", async () => {
    const request = jest.fn<FacebookCommentRequest>();
    for (const source of [
      { ...posts, status: "unavailable" as const },
      { ...posts, items: [{ id: "88_1" }] }, { ...posts, items: [{ id: "99_1" }, { id: "99_1" }] },
      { ...posts, items: Array.from({ length: 51 }, (_, i) => ({ id: `99_${i}` })) },
    ]) expect(await collectFacebookCommentCounts(request, "99", source, window)).toMatchObject({ status: "unavailable", total: null, complete: false });
    expect(await collectFacebookCommentCounts(request, "../me", posts, window)).toMatchObject({ failureCode: "INVALID_COMMENT_REQUEST" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not count malformed/missing timestamps or expose provider errors", async () => {
    for (const raw of [{ data: [{ id: "1" }] }, { data: [{ id: "1", created_time: "invalid" }] }, { data: [{ id: "1", created_time: 1 }] }]) {
      const request = jest.fn<FacebookCommentRequest>().mockResolvedValue(raw);
      expect(await collectFacebookCommentCounts(request, "99", onePost, window)).toMatchObject({ total: null, complete: false, failureCode: "COMMENT_COLLECTION_FAILED" });
    }
    const request = jest.fn<FacebookCommentRequest>().mockRejectedValue(new Error("private-token"));
    const result = await collectFacebookCommentCounts(request, "99", onePost, window);
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate comments both within and across posts", async () => {
    for (const within of [true, false]) {
      const request = jest.fn<FacebookCommentRequest>().mockResolvedValue({ data: within ? [comment("1"), comment("1")] : [comment("1")] });
      expect(await collectFacebookCommentCounts(request, "99", posts, window)).toMatchObject({ total: null, complete: false, failureCode: "DUPLICATE_COMMENT_IDS" });
    }
  });

  it("rejects missing/repeated cursors and limits pages without retries or arbitrary URLs", async () => {
    for (const kind of ["missing", "repeat", "limit"]) {
      let calls = 0;
      const request = jest.fn<FacebookCommentRequest>().mockImplementation(async () => {
        calls++;
        return { data: [comment(String(calls))], paging: { next: "https://attacker.invalid", cursors: kind === "missing" ? undefined : { after: kind === "repeat" ? "same" : String(calls) } } };
      });
      const result = await collectFacebookCommentCounts(request, "99", onePost, window);
      expect(result).toMatchObject({ total: null, complete: false, observedTotal: kind === "missing" ? 1 : kind === "repeat" ? 2 : 5 });
      expect(calls).toBeLessThanOrEqual(5);
    }
  });

  it("enforces the global 150-request bound across posts", async () => {
    let calls = 0;
    const request = jest.fn<FacebookCommentRequest>().mockImplementation(async () => {
      calls++;
      return { data: [comment(String(calls))], ...(calls % 5 ? { paging: { next: "unused", cursors: { after: String(calls) } } } : {}) };
    });
    const source = { ...posts, items: Array.from({ length: 31 }, (_, i) => ({ id: `99_${i}` })) };
    expect(await collectFacebookCommentCounts(request, "99", source, window)).toMatchObject({ total: null, observedTotal: 150, postsChecked: 30, failureCode: "COMMENT_REQUEST_LIMIT" });
    expect(request).toHaveBeenCalledTimes(150);
  });

  it("enumerates older Page history separately when the saved sample is truncated", async () => {
    const request = jest.fn<FacebookCommentRequest>().mockImplementation(async (path, params) => {
      if (path === "99_7/comments") {
        expect(params).toMatchObject({ after: "comment-cursor", fields: "id,created_time", filter: "stream", since: String(Date.parse(window.since) / 1000) });
        return { data: [comment("22")] };
      }
      expect(path).toBe("99/posts");
      expect(params.fields).toBe(`id,comments.filter(stream).order(chronological).since(${Date.parse(window.since) / 1000}).limit(100){id,created_time}`);
      expect(params).not.toHaveProperty("since");
      if (params.after === "post-cursor") return { data: [{ id: "99_8", comments: { data: [comment("23")] } }] };
      return { data: [{ id: "99_7", comments: { data: [comment("21")], paging: { next: "ignored-private-url", cursors: { after: "comment-cursor" } } } }],
        paging: { next: "https://attacker.invalid", cursors: { after: "post-cursor" } } };
    });
    const result = await collectFacebookCommentCounts(request, "99", { ...posts, truncated: true }, window);
    expect(result).toMatchObject({ total: 3, complete: true, postsCollected: 2, postsChecked: 2 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toMatch(/attacker|private/);
  });

  it("does not infer zero from malformed nested comments or wrong/duplicate historical targets", async () => {
    for (const raw of [
      { data: [{ id: "99_7", comments: null }] },
      { data: [{ id: "88_7", comments: { data: [] } }] },
      { data: [{ id: "99_7", comments: { data: [] } }, { id: "99_7", comments: { data: [] } }] },
      { data: [{ id: "99_7", comments: { data: [comment("1")] } }, { id: "99_8", comments: { data: [comment("1")] } }] },
    ]) {
      const request = jest.fn<FacebookCommentRequest>().mockResolvedValue(raw);
      expect(await collectFacebookCommentCounts(request, "99", { ...posts, truncated: true }, window)).toMatchObject({ total: null, complete: false });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("reads the explicit comment edge when expansion omits it, establishing zero only after that read", async () => {
    const request = jest.fn<FacebookCommentRequest>().mockImplementation(async (path, params) => {
      if (path === "99/posts") return { data: [{ id: "99_7" }, { id: "99_8" }] };
      expect(params).toMatchObject({ fields: "id,created_time", filter: "stream", order: "chronological", since: String(Date.parse(window.since) / 1000), limit: "100" });
      if (path === "99_7/comments") return { data: [comment("1")] };
      if (path === "99_8/comments") return { data: [] };
      throw new Error("Unexpected request");
    });
    expect(await collectFacebookCommentCounts(request, "99", { ...posts, truncated: true }, window)).toMatchObject({ total: 1, complete: true, postsCollected: 2, postsChecked: 2 });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not turn a failed explicit fallback edge into zero", async () => {
    const request = jest.fn<FacebookCommentRequest>().mockImplementation(async path => {
      if (path === "99/posts") return { data: [{ id: "99_7" }] };
      throw new Error("private provider error");
    });
    const result = await collectFacebookCommentCounts(request, "99", { ...posts, truncated: true }, window);
    expect(result).toMatchObject({ total: null, complete: false, postsChecked: 0, failureCode: "COMMENT_COLLECTION_FAILED" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("private provider error");
  });

  it("bounds expanded post pagination and rejects missing or repeated historical cursors", async () => {
    for (const kind of ["missing", "repeat", "limit"]) {
      let calls = 0;
      const request = jest.fn<FacebookCommentRequest>().mockImplementation(async () => {
        calls++;
        return { data: [{ id: `99_${calls}`, comments: { data: [] } }], paging: { next: "ignored", cursors: kind === "missing" ? undefined : { after: kind === "repeat" ? "same" : String(calls) } } };
      });
      const result = await collectFacebookCommentCounts(request, "99", { ...posts, truncated: true }, window);
      expect(result).toMatchObject({ total: null, complete: false });
      expect(calls).toBe(kind === "missing" ? 1 : kind === "repeat" ? 2 : 10);
    }
  });

  it("accepts exactly 250 historical posts only when their listing is exhausted", async () => {
    let calls = 0;
    const request = jest.fn<FacebookCommentRequest>().mockImplementation(async () => {
      const batch = calls++;
      return { data: Array.from({ length: 25 }, (_, i) => ({ id: `99_${batch * 25 + i}`, comments: { data: [] } })),
        ...(calls < 10 ? { paging: { next: "ignored", cursors: { after: String(calls) } } } : {}) };
    });
    expect(await collectFacebookCommentCounts(request, "99", { ...posts, truncated: true }, window)).toMatchObject({ total: 0, complete: true, postsCollected: 250, postsChecked: 250 });
    expect(request).toHaveBeenCalledTimes(10);
  });
});
