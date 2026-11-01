import { jest } from "@jest/globals";
import { collectFacebookPostWindow, facebookPostCoverageSchema, facebookPublishingWindow, verifyFacebookPostCoverage, type FacebookPostWindow } from "../src/integrations/facebook/post-coverage.js";

const observedAt = "2026-11-01T12:30:00.000Z";
const cutoff = "2026-11-01T00:00:00.000Z";
const since = "2026-10-04T00:00:00.000Z";
const post = (id: number, created_time: unknown = "2026-10-15T12:00:00+0000") => ({ id: `123_${id}`, created_time, message: `Saved post ${id}` });
type Request = (path: string, params: Record<string, string>) => Promise<unknown>;
const evidence = (result: FacebookPostWindow) => ({ status: result.status, truncated: String(result.truncated), items: JSON.stringify(result.items), coverage: JSON.stringify(result.coverage) });

describe("bounded explicitly queried Facebook publishing windows (offline fixtures)", () => {
  let request: ReturnType<typeof jest.fn<Request>>;
  beforeEach(() => { request = jest.fn<Request>(); });
  const collect = (signal?: AbortSignal) => collectFacebookPostWindow(request, "123", observedAt, signal);

  it("separates the latest complete UTC day from collection time and requests four full weeks", async () => {
    request.mockResolvedValue({ data: [post(1)] });
    const result = await collect();
    expect(facebookPublishingWindow(observedAt)).toEqual({ since, until: cutoff });
    expect(request).toHaveBeenCalledWith("123/posts", { fields: "id,message,created_time", limit: "25", since: String(Date.parse(since) / 1000), until: String(Date.parse(cutoff) / 1000) });
    expect(result).toMatchObject({ status: "available", truncated: false, collectedAt: observedAt,
      coverage: { kind: "queried-window", since, until: cutoff, observedAt, complete: true, exhausted: true, pagesRead: 1, reason: "complete" } });
    expect(facebookPostCoverageSchema.safeParse(result.coverage).success).toBe(true);
  });

  it("allows a complete filtered empty response to establish four known zero periods", async () => {
    request.mockResolvedValue({ data: [] });
    const result = await collect();
    expect(result.items).toEqual([]); expect(result.coverage.complete).toBe(true);
    const verified = verifyFacebookPostCoverage(result, evidence(result), cutoff, observedAt);
    expect(verified.complete).toBe(true);
    expect(verified.periods.map(period => period.count)).toEqual([0, 0, 0, 0]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("counts full periods without assuming Graph order and preserves exact boundary ownership", async () => {
    request.mockResolvedValue({ data: [post(4, "2026-10-31T23:59:59Z"), post(1, since), post(3, "2026-10-24T12:00:00Z"), post(2, "2026-10-18T00:00:00Z")] });
    const result = await collect();
    const verified = verifyFacebookPostCoverage(result, evidence(result), cutoff, observedAt);
    expect(verified.complete).toBe(true);
    expect(verified.periods.map(period => period.count)).toEqual([1, 0, 2, 1]);
    expect(verified.periods[0]).toMatchObject({ startAt: since, endAt: "2026-10-11T00:00:00.000Z" });
    expect(verified.periods[3].endAt).toBe(cutoff);
    expect(result.items.map(item => item.id)).toEqual(["123_4", "123_1", "123_3", "123_2"]);
  });

  it("uses only bounded after cursors and never follows or persists provider paging URLs", async () => {
    request.mockResolvedValueOnce({ data: [post(1)], paging: { next: "https://attacker.invalid/private?access_token=secret", cursors: { after: "cursor-one" } } })
      .mockResolvedValueOnce({ data: [post(2)], paging: { cursors: { after: "final-cursor-without-next" } } });
    const result = await collect();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(["123/posts", expect.objectContaining({ after: "cursor-one", since: String(Date.parse(since) / 1000), until: String(Date.parse(cutoff) / 1000) })]);
    expect(result.coverage).toMatchObject({ complete: true, exhausted: true, pagesRead: 2 });
    expect(JSON.stringify(result)).not.toContain("attacker.invalid"); expect(JSON.stringify(result)).not.toContain("access_token");
  });

  it("supports exactly four pages and 100 posts only when pagination really exhausts", async () => {
    for (let page = 0; page < 4; page++) request.mockResolvedValueOnce({ data: Array.from({ length: 25 }, (_, index) => post(page * 25 + index)), ...(page < 3 ? { paging: { next: "opaque", cursors: { after: `cursor-${page}` } } } : {}) });
    const result = await collect();
    expect(result.items).toHaveLength(100);
    expect(result.coverage).toMatchObject({ complete: true, exhausted: true, pagesRead: 4, itemsLimit: 100 });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("never treats a capped four-page result as complete or issues a fifth request", async () => {
    for (let page = 0; page < 4; page++) request.mockResolvedValueOnce({ data: Array.from({ length: 25 }, (_, index) => post(page * 25 + index)), paging: { next: "opaque", cursors: { after: `cursor-${page}` } } });
    const result = await collect();
    expect(result.items).toHaveLength(100);
    expect(result).toMatchObject({ truncated: true, coverage: { complete: false, exhausted: false, reason: "page-limit", pagesRead: 4 } });
    expect(request).toHaveBeenCalledTimes(4);
    expect(verifyFacebookPostCoverage(result, evidence(result), cutoff, observedAt).complete).toBe(false);
  });

  it("stops on absent or repeated cursors without guessing from row dates", async () => {
    request.mockResolvedValueOnce({ data: [post(1)], paging: { next: "opaque" } });
    expect((await collect()).coverage.reason).toBe("cursor-unavailable");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockReset().mockResolvedValueOnce({ data: [post(1)], paging: { next: "opaque", cursors: { after: "same" } } }).mockResolvedValueOnce({ data: [post(2)], paging: { next: "opaque", cursors: { after: "same" } } });
    expect((await collect()).coverage.reason).toBe("cursor-loop");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not infer completeness from old rows outside the requested window", async () => {
    request.mockResolvedValue({ data: [post(1, "2025-01-01T00:00:00Z"), post(2, cutoff), post(3, "2026-11-02T00:00:00Z")] });
    const result = await collect();
    expect(result.items).toEqual([]);
    expect(result.coverage).toMatchObject({ complete: false, exhausted: true, ignoredOutOfWindow: 3, reason: "out-of-window" });
    expect(verifyFacebookPostCoverage(result, evidence(result), cutoff, observedAt).complete).toBe(false);
  });

  it("retains valid records but flags duplicated IDs instead of counting twice", async () => {
    request.mockResolvedValueOnce({ data: [post(1)], paging: { next: "opaque", cursors: { after: "next" } } }).mockResolvedValueOnce({ data: [post(1), post(2)] });
    const result = await collect();
    expect(result.items).toHaveLength(2);
    expect(result.coverage).toMatchObject({ complete: false, exhausted: true, duplicateIds: 1, reason: "duplicate-post" });
  });

  it.each([undefined, null, "not-a-date", "2026-10-15T12:00:00", "2026-02-30T12:00:00Z", "2026-10-15T25:00:00Z"])("keeps missing/malformed timestamp %s unknown", async created => {
    request.mockResolvedValue({ data: [{ ...post(1), created_time: created }] });
    const result = await collect();
    expect(result.items[0].createdTime).toBeNull();
    expect(result.coverage).toMatchObject({ complete: false, invalidTimestamps: 1, reason: "invalid-timestamp" });
  });

  it("normalizes Graph timestamps with offsets without changing the UTC reporting boundaries", async () => {
    request.mockResolvedValue({ data: [post(1, "2026-10-15T12:00:00-0700")] });
    const result = await collect();
    expect(result.items[0].createdTime).toBe("2026-10-15T19:00:00.000Z");
    expect(result.coverage.complete).toBe(true);
  });

  it("rejects wrong Page records, malformed response shape and oversized pages without hiding the limitation", async () => {
    request.mockResolvedValueOnce({ data: [{ ...post(1), id: "456_1" }] });
    expect(await collect()).toMatchObject({ status: "unavailable", coverage: { complete: false, reason: "invalid-response" } });
    request.mockReset().mockResolvedValueOnce({ data: "not-an-array" });
    expect((await collect()).coverage.reason).toBe("invalid-response");
    request.mockReset().mockResolvedValueOnce({ data: Array.from({ length: 26 }, (_, index) => post(index)) });
    const oversized = await collect(); expect(oversized.items).toHaveLength(25); expect(oversized.coverage.reason).toBe("page-size-exceeded");
  });

  it("retains partial evidence on a failed second page without retrying or exposing provider error text", async () => {
    request.mockResolvedValueOnce({ data: [post(1)], paging: { next: "opaque", cursors: { after: "next" } } }).mockRejectedValueOnce(new Error("private-token and private-error-body"));
    const result = await collect();
    expect(result).toMatchObject({ status: "unavailable", truncated: true, failureCode: "POST_WINDOW_REQUEST_FAILED", coverage: { complete: false, reason: "request-failed", pagesRead: 1 } });
    expect(result.items).toHaveLength(1); expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("honors cancellation before and after a request without dispatching further pages", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await collect(controller.signal)).coverage.reason).toBe("aborted"); expect(request).not.toHaveBeenCalled();
    const later = new AbortController(); request.mockImplementationOnce(async () => { later.abort(); return { data: [post(1)] }; });
    const result = await collect(later.signal);
    expect(result).toMatchObject({ status: "unavailable", items: [], failureCode: "POST_WINDOW_ABORTED" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never promotes legacy samples or mismatched evidence to complete posting history", async () => {
    request.mockResolvedValue({ data: [] }); const result = await collect();
    const { coverage: _coverage, ...legacy } = result; void _coverage;
    expect(verifyFacebookPostCoverage(legacy, evidence(result), cutoff, observedAt).complete).toBe(false);
    for (const wrong of [null, { ...evidence(result), coverage: "not-json" }, { ...evidence(result), status: "missing" }, { ...evidence(result), items: JSON.stringify([post(1)]) }]) expect(verifyFacebookPostCoverage(result, wrong, cutoff, observedAt).complete).toBe(false);
    expect(verifyFacebookPostCoverage(result, evidence(result), "2026-11-02T00:00:00.000Z", "2026-11-02T12:00:00.000Z").complete).toBe(false);
    expect(verifyFacebookPostCoverage(result, evidence(result), cutoff, "2026-11-01T01:00:00.000Z").complete).toBe(false);
  });

  it("rechecks stored item identity, timestamps and proof consistency even when a record claims completion", async () => {
    request.mockResolvedValue({ data: [post(1)] }); const original = await collect();
    for (const changed of [
      { ...original, items: [original.items[0], original.items[0]] },
      { ...original, items: [{ ...original.items[0], createdTime: null }] },
      { ...original, items: [{ ...original.items[0], url: "https://attacker.invalid/" }] },
      { ...original, coverage: { ...original.coverage, exhausted: false } },
      { ...original, coverage: { ...original.coverage, ignoredOutOfWindow: 1 } },
    ]) expect(verifyFacebookPostCoverage(changed, evidence(changed), cutoff, observedAt).complete).toBe(false);
  });
});
