import "reflect-metadata";
import { jest } from "@jest/globals";
import { probeFacebookComments } from "../src/integrations/facebook/comment-probes.js";

it("diagnoses omitted expanded edges while excluding comment text, IDs, people and paging URLs", async () => {
  const request = jest.fn(async (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
    if (path === "99/posts" && params.fields === "id") return { data: [{ id: "99_1" }] };
    const comments = { data: [{ id: "private-comment-id", created_time: "2026-10-30T12:00:00Z", message: "private content", from: { name: "Private person" } }] };
    if (path.endsWith("/comments")) return comments;
    return { data: [{ id: "99_1", comments }, { id: "99_2" }], paging: { next: "https://secret.invalid" } };
  });
  const result = await probeFacebookComments(request, "99");
  expect(result.probes[0]).toMatchObject({ returnedComments: 0 });
  expect(result.probes.at(-1)).toMatchObject({ postsWithCommentsField: 1, returnedComments: 1, commentsWithCreatedTime: 1 });
  expect(JSON.stringify(result)).not.toMatch(/private-comment-id|private content|Private person|secret.invalid/);
  expect(request).toHaveBeenCalledTimes(6);
});

it("rejects arbitrary paths and does not probe a post outside the selected Page", async () => {
  const request = jest.fn<(path: string, params: Record<string, string>) => Promise<Record<string, unknown>>>()
    .mockResolvedValue({ data: [{ id: "88_1" }] });
  await expect(probeFacebookComments(request, "../me")).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await probeFacebookComments(request, "99");
  expect(request.mock.calls.every(call => !(call[0] as string).startsWith("88_"))).toBe(true);
});
