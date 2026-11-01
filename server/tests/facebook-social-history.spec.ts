import { jest } from "@jest/globals";
import { collectFacebookSocialHistory, facebookSocialHistoryEvidence, facebookSocialHistorySchema, facebookSocialHistoryWindow, verifyFacebookSocialHistory } from "../src/integrations/facebook/social-history.js";

const observedAt = "2026-11-01T12:30:00.000Z", cutoff = "2026-11-01T00:00:00.000Z", since = "2026-08-03T00:00:00.000Z";
type Request = (path: string, params: Record<string, string>) => Promise<unknown>;
const post = (id = 1, created_time: unknown = "2026-09-15T12:00:00+0000") => ({ id: `123_${id}`, created_time, message: `Useful saved post ${id}` });

describe("bounded 90 completed UTC-day Facebook social history", () => {
  let request: ReturnType<typeof jest.fn<Request>>;
  beforeEach(() => { request = jest.fn<Request>(); });
  const collect = (signal?: AbortSignal) => collectFacebookSocialHistory(request, "123", observedAt, signal);
  const verify = (history: Awaited<ReturnType<typeof collect>>, evidence = facebookSocialHistoryEvidence(history), pageId = "123", at = observedAt) => verifyFacebookSocialHistory(history, evidence, pageId, at);

  it("queries exactly 90 completed days, preserving legacy posting windows separately", async () => {
    request.mockResolvedValue({ data: [post()] });
    const history = await collect();
    expect(facebookSocialHistoryWindow(observedAt)).toEqual({ since, until: cutoff });
    expect(request).toHaveBeenCalledWith("123/posts", { fields: "id,message,created_time", limit: "25", since: String(Date.parse(since) / 1000), until: String(Date.parse(cutoff) / 1000) });
    expect(history.coverage).toMatchObject({ complete: true, exhausted: true, pagesRead: 1, maxPages: 10, itemsLimit: 250 });
    expect(facebookSocialHistorySchema.safeParse(history).success).toBe(true);
    expect(verify(history)).toMatchObject({ complete: true, contentComplete: true, since, until: cutoff });
  });
  it("establishes verified zero posts only when the filtered listing is exhausted", async () => {
    request.mockResolvedValue({ data: [] });
    const history = await collect();
    expect(verify(history)).toMatchObject({ complete: true, items: [] });
    expect(verifyFacebookSocialHistory(undefined, null, "123", observedAt).complete).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("preserves omitted message as unknown, distinct from an explicitly returned empty string", async () => {
    request.mockResolvedValue({ data: [{ id: "123_1", created_time: since }, { ...post(2), message: "" }] });
    const history = await collect();
    expect(history.items).toEqual([expect.objectContaining({ message: null, messageStatus: "not-returned" }), expect.objectContaining({ message: "", messageStatus: "available" })]);
    expect(verify(history)).toMatchObject({ complete: true, contentComplete: false });
  });
  it("retains UTF-8 text without placing raw text or identities in duplicate evidence", async () => {
    request.mockResolvedValue({ data: [{ ...post(), message: "Consulta de impuestos: información útil para su negocio." }] });
    const history = await collect(), evidence = facebookSocialHistoryEvidence(history);
    expect(history.items[0]!.message).toContain("información útil");
    expect(evidence.itemsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toContain("Consulta");
    expect(evidence).not.toHaveProperty("items");
  });
  it("bounds retained text separately without inventing empty content or losing post timing coverage", async () => {
    request.mockResolvedValue({ data: Array.from({ length: 25 }, (_, index) => ({ ...post(index), message: "x".repeat(100000) })) });
    const history = await collect();
    expect(history.coverage.complete).toBe(true);
    expect(history.items).toHaveLength(25);
    expect(history.items.filter(item => item.messageStatus === "not-retained")).toHaveLength(5);
    expect(history.items.filter(item => item.messageStatus === "not-retained").every(item => item.message === null)).toBe(true);
    expect(verify(history)).toMatchObject({ complete: true, contentComplete: false });
  });
  it("does not assume sort order or clip rows outside the requested window into completeness", async () => {
    request.mockResolvedValue({ data: [post(3, "2026-10-31T23:59:59Z"), post(1, since), post(2, "2026-09-15T00:00:00Z")] });
    const complete = await collect(); expect(verify(complete).complete).toBe(true);
    request.mockResolvedValue({ data: [post(1, "2026-08-02T23:59:59Z"), post(2, cutoff)] });
    const wrong = await collect(); expect(wrong.items).toEqual([]);
    expect(wrong.coverage).toMatchObject({ complete: false, ignoredOutOfWindow: 2, reason: "out-of-window" });
  });
  it("uses only opaque after cursors and never follows or saves provider paging URLs", async () => {
    request.mockResolvedValueOnce({ data: [post()], paging: { next: "https://attacker.invalid/?access_token=secret", cursors: { after: "opaque" } } })
      .mockResolvedValueOnce({ data: [post(2)] });
    const history = await collect();
    expect(request.mock.calls[1]).toEqual(["123/posts", expect.objectContaining({ after: "opaque" })]);
    expect(history.coverage.complete).toBe(true);
    expect(JSON.stringify(history)).not.toContain("attacker.invalid"); expect(JSON.stringify(history)).not.toContain("access_token");
  });
  it("allows 250 posts only when page ten actually exhausts", async () => {
    for (let page = 0; page < 10; page++) request.mockResolvedValueOnce({ data: Array.from({ length: 25 }, (_, index) => post(page * 25 + index)), ...(page < 9 ? { paging: { next: "opaque", cursors: { after: `cursor-${page}` } } } : {}) });
    const history = await collect(); expect(history.items).toHaveLength(250); expect(verify(history).complete).toBe(true);
    expect(request).toHaveBeenCalledTimes(10);
  });
  it("never treats a request bound as complete or starts an eleventh request", async () => {
    for (let page = 0; page < 10; page++) request.mockResolvedValueOnce({ data: [post(page)], paging: { next: "opaque", cursors: { after: `cursor-${page}` } } });
    const history = await collect(); expect(history.coverage).toMatchObject({ complete: false, exhausted: false, reason: "page-limit" });
    expect(verify(history).complete).toBe(false); expect(request).toHaveBeenCalledTimes(10);
  });
  it("rejects cursor loops and missing cursors without repeating requests", async () => {
    request.mockResolvedValue({ data: [], paging: { next: "opaque" } });
    expect((await collect()).coverage.reason).toBe("cursor-unavailable"); expect(request).toHaveBeenCalledTimes(1);
    request.mockReset().mockResolvedValueOnce({ data: [post()], paging: { next: "opaque", cursors: { after: "same" } } })
      .mockResolvedValueOnce({ data: [post(2)], paging: { next: "opaque", cursors: { after: "same" } } });
    expect((await collect()).coverage.reason).toBe("cursor-loop"); expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects wrong Page IDs, invalid shapes, excessive page sizes and invalid timestamps", async () => {
    request.mockResolvedValue({ data: [{ ...post(), id: "999_1" }] }); expect((await collect()).coverage.reason).toBe("invalid-response");
    request.mockResolvedValue({ data: "unexpected" }); expect((await collect()).coverage.reason).toBe("invalid-response");
    request.mockResolvedValue({ data: Array.from({ length: 26 }, (_, index) => post(index)) }); expect((await collect()).coverage.reason).toBe("page-size-exceeded");
    request.mockResolvedValue({ data: [post(1, "invalid")] }); expect((await collect()).coverage.reason).toBe("invalid-timestamp");
    request.mockResolvedValue({ data: [post(), post()] }); expect((await collect()).coverage.reason).toBe("duplicate-post");
  });
  it("does not retry provider failures or run requests after an abort", async () => {
    request.mockRejectedValue(new Error("private provider details"));
    const failed = await collect(); expect(failed.status).toBe("unavailable"); expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(failed)).not.toContain("private provider details");
    request.mockClear(); const controller = new AbortController(); controller.abort();
    expect((await collect(controller.signal)).coverage.reason).toBe("aborted"); expect(request).not.toHaveBeenCalled();
  });
  it("requires matching separate evidence and rejects changed content, identity, dates and coverage", async () => {
    request.mockResolvedValue({ data: [post()] });
    const history = await collect(), evidence = facebookSocialHistoryEvidence(history);
    expect(verify(history, { ...evidence, itemsHash: "a".repeat(64) }).complete).toBe(false);
    const changed = structuredClone(history); changed.items[0]!.message = "Changed text";
    expect(verify(changed, evidence).complete).toBe(false);
    expect(verify(history, evidence, "999").complete).toBe(false);
    expect(verify(history, evidence, "123", "2026-11-01T01:00:00Z").complete).toBe(false);
    expect(verify(history, evidence, "123", "2026-11-08T12:30:00.001Z").complete).toBe(false);
    const duplicate = structuredClone(history); duplicate.items.push(duplicate.items[0]!);
    expect(verify(duplicate, facebookSocialHistoryEvidence(duplicate)).complete).toBe(false);
    const wrongUrl = structuredClone(history); wrongUrl.items[0]!.url = "https://www.facebook.com/123_2";
    expect(verify(wrongUrl, facebookSocialHistoryEvidence(wrongUrl)).complete).toBe(false);
  });
});
