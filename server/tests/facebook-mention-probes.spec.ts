import "reflect-metadata";
import { jest } from "@jest/globals";
import { probeFacebookMentions } from "../src/integrations/facebook/mention-probes.js";
import { FacebookError } from "../src/modules/facebook/facebook.service.js";

const now = new Date("2026-11-01T18:00:00Z");
const date = "2026-10-30T12:00:00Z";

describe("Facebook mention capability probes", () => {
  it("recognizes exact Page-ID mention tags, deduplicates known authors and excludes self-authored mentions", async () => {
    const comment = { id: "99_1_1", created_time: date, message_tags: [{ id: "99", name: "Private mention name" }], from: { id: "77777777", name: "Private author" }, message: "private comment text" };
    const request = jest.fn(async (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
      if (path === "99/posts") return { data: [{ id: "99_1" }] };
      if (path === comment.id) return comment;
      if (path === "99_1/comments") return { data: [comment] };
      if (!params.fields.includes("message_tags")) return { data: [] };
      return { data: [
        { id: "77777777_3", created_time: date, message_tags: { "0": [{ id: "99" }] }, from: { id: "77777777" } },
        { id: "99_4", created_time: date, message_tags: [{ id: "99" }], from: { id: "99" } },
        { id: "88_5", created_time: date, message_tags: [{ id: "88" }], message: "Guzman Tax Accounting" },
      ] };
    });
    const result = await probeFacebookMentions(request, "99", now);
    expect(result.uniqueKnownMentionAuthorsInSample).toBe(1);
    expect(result.uniquePeopleMentioningBusiness).toBeNull();
    expect(result.probes.find(item => item.label === "tagged: mention tags and author IDs")).toMatchObject({ targetMentionRecords: 1, selfAuthoredMentionsExcluded: 1 });
    expect(result.probes.at(-1)).toMatchObject({ recordsWithAuthorId: 1, targetMentionRecords: 1 });
    expect(JSON.stringify(result)).not.toMatch(/77777777|Private author|Private mention name|private comment text|Guzman Tax Accounting|99_1_1/);
    expect(request.mock.calls.every(([, params]) => !params.fields.split(",").includes("message"))).toBe(true);
  });

  it("preserves missing metadata, unknown authors and incomplete sampling instead of publishing zero people", async () => {
    const request = jest.fn(async (path: string): Promise<Record<string, unknown>> => {
      if (path === "99/posts") return { data: [{ id: "99_1" }], paging: { next: "https://private.invalid" } };
      if (path === "99_1/comments") return { data: [
        { id: "99_1_1", created_time: date, message_tags: [{ id: "99" }], from: null },
        { id: "99_1_2", created_time: date, message_tags: null },
      ] };
      if (path === "99_1_1" || path === "99_1_2") return { id: path, created_time: date };
      return { data: [] };
    });
    const result = await probeFacebookMentions(request, "99", now);
    expect(result.probes.find(item => item.label === "Comments on 99_1: mention tags and author IDs")).toMatchObject({ targetMentionRecords: 1, targetMentionsWithoutAuthor: 1, recordsWithAuthorId: 0 });
    expect(result.uniquePeopleMentioningBusiness).toBeNull();
    expect(result.uniqueKnownMentionAuthorsInSample).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private.invalid");
    expect(request).toHaveBeenCalledTimes(8);
  });

  it("filters the period, bounds direct node checks and preserves numeric provider errors without raw content", async () => {
    const request = jest.fn(async (path: string): Promise<Record<string, unknown>> => {
      if (path === "99/posts") return { data: [{ id: "99_1" }] };
      if (path === "99_1/comments") return { data: Array.from({ length: 5 }, (_, index) => ({ id: `99_1_${index}`, created_time: index === 0 ? "2026-11-01T07:00:00Z" : date, message_tags: [{ id: "99" }] })) };
      throw new FacebookError("PROVIDER_REJECTED", 100, 33);
    });
    const result = await probeFacebookMentions(request, "99", now);
    expect(result.probes.find(item => item.label === "Comments on 99_1: mention tags and author IDs")).toMatchObject({ recordsInWindow: 4, targetMentionRecords: 4 });
    expect(result.probes.filter(item => String(item.label).startsWith("Direct comment node"))).toHaveLength(2);
    expect(result.probes.at(-1)).toMatchObject({ status: "unavailable", providerCode: 100, providerSubcode: 33 });
    expect(request.mock.calls.some(([path]) => path === "99_1_0")).toBe(false);
  });

  it("rejects arbitrary Page paths and never follows wrong-Page comment targets", async () => {
    const request = jest.fn(async (path: string): Promise<Record<string, unknown>> =>
      ({ data: path === "99/posts" ? [{ id: "88_1", created_time: date, message_tags: [{ id: "99" }], from: { id: "77777777" } }] : [] }));
    await expect(probeFacebookMentions(request, "../me", now)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const result = await probeFacebookMentions(request, "99", now);
    expect(result.uniqueKnownMentionAuthorsInSample).toBe(0);
    expect(request.mock.calls.some(([path]) => path.startsWith("88"))).toBe(false);
  });
});
