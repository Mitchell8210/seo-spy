import { jest } from "@jest/globals";

type Proposal = {
  version: string; id: string; hash: string; businessId: string; siteUrl: string; resource: string; resourceId: number;
  before: { altText: string }; changes: Record<string, string>; modified: string; expiresAt: string;
  executionStarted?: boolean; outcome?: Record<string, unknown> | null;
};
type Dependencies = {
  env: Record<string, string>; fetch: typeof fetch; readText: (path: string) => Promise<string>;
  output: (value: unknown) => void; now: () => number;
};
type Run = (argv: string[], dependencies: Dependencies) => Promise<Record<string, unknown>>;
let run: Run;
beforeAll(async () => {
  const script = "../scripts/wordpress-staging.mjs";
  run = (await import(script)).runWordPressStaging as Run;
});

const key = "private-operator-key-at-least-32-characters";
const proposalId = "485d4048-6e9b-4a25-89a3-c21e63ca2960";
const hash = "a".repeat(64);
const common = ["--api-origin=http://127.0.0.1:3001", "--business-id=example", "--site-url=https://example.com", "--target-confirmed"];
const preview = [...common, "--mode=preview", "--resource-id=7", "--alt-text-file=./alt.txt"];
const apply = [...common, "--mode=apply", `--proposal-id=${proposalId}`, `--proposal-hash=${hash}`, "--confirmed"];
const inspect = [...common, "--mode=inspect", `--proposal-id=${proposalId}`];

function fixture() {
  const proposal: Proposal = {
    version: "wordpress-proposal-v1", id: proposalId, hash, businessId: "example", siteUrl: "https://example.com",
    resource: "media", resourceId: 7, before: { altText: "Old alt" }, changes: { altText: "Approved alt" },
    modified: "2026-10-31T00:00:00", expiresAt: "2026-10-31T01:00:00Z", executionStarted: false, outcome: null,
  };
  const connection = { businessId: "example", siteUrl: "https://example.com", authenticated: true, mode: "local_operator", writesEnabled: false };
  const output = jest.fn<(value: unknown) => void>();
  const requests: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const transport = jest.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ method, path, body });
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${key}` });
    let value: unknown;
    if (path.endsWith("/connection")) value = connection;
    else if (path.endsWith("/apply") && method === "POST") {
      proposal.executionStarted = true;
      proposal.outcome = { id: proposalId, businessId: "example", status: "applied", verification: "verified_stored_fields" };
      value = proposal.outcome;
    } else if (path.endsWith("/proposals") && method === "POST") value = proposal;
    else if (path.endsWith(`/proposals/${proposalId}`) && method === "GET") value = proposal;
    else throw new Error("Unexpected fixture request");
    return new Response(JSON.stringify(value), { status: method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
  });
  const dependencies: Dependencies = { env: { WORDPRESS_OPERATOR_KEY: key }, fetch: transport, readText: async () => "Approved alt", output, now: () => Date.parse("2026-10-31T00:30:00Z") };
  return { proposal, connection, transport, requests, output, dependencies };
}

describe("WordPress media pilot script with controlled local API fixtures", () => {
  it("creates only a reviewed alt-text proposal while writes are disabled", async () => {
    const f = fixture();
    const result = await run(preview, f.dependencies);
    expect(result.mode).toBe("preview");
    expect(f.requests.map(item => [item.method, item.path.split("/").at(-1)])).toEqual([["GET", "connection"], ["POST", "proposals"]]);
    expect(f.requests[1].body).toEqual({ resource: "media", resourceId: 7, changes: { altText: "Approved alt" } });
    expect(JSON.stringify(f.output.mock.calls)).not.toContain(key);
  });

  it("rejects a wrong installation before reading a file or creating any proposal", async () => {
    const f = fixture();
    f.connection.siteUrl = "https://different.example";
    const read = jest.fn<Dependencies["readText"]>();
    await expect(run(preview, { ...f.dependencies, readText: read })).rejects.toThrow("does not match");
    expect(f.requests).toHaveLength(1);
    expect(read).not.toHaveBeenCalled();
  });

  it("requires a loopback API, explicit target and bounded text before proposing", async () => {
    const f = fixture();
    await expect(run(preview.filter(item => item !== "--target-confirmed"), f.dependencies)).rejects.toThrow("--target-confirmed");
    await expect(run(preview.map(item => item.startsWith("--api-origin=") ? "--api-origin=https://attacker.example" : item), f.dependencies)).rejects.toThrow("loopback");
    expect(f.transport).not.toHaveBeenCalled();
    await expect(run(preview, { ...f.dependencies, readText: async () => "x".repeat(2001) })).rejects.toThrow("2000");
    expect(f.requests.every(item => item.method === "GET")).toBe(true);
  });

  it("applies the exact existing hash once then reads its saved receipt without creating proposals", async () => {
    const f = fixture();
    f.connection.writesEnabled = true;
    const result = await run(apply, f.dependencies);
    expect(result.outcome).toMatchObject({ status: "applied", verification: "verified_stored_fields" });
    const posts = f.requests.filter(item => item.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(`/api/wordpress/businesses/example/proposals/${proposalId}/apply`);
    expect(posts[0].body).toEqual({ proposalHash: hash, confirmed: true });
    expect(f.requests.at(-1)?.method).toBe("GET");
  });

  it("rejects a mismatched hash, disabled gate, expired proposal and broad patch before Apply", async () => {
    const f = fixture();
    await expect(run(apply.map(item => item.startsWith("--proposal-hash=") ? `--proposal-hash=${"b".repeat(64)}` : item), f.dependencies)).rejects.toThrow("hash");
    await expect(run(apply, f.dependencies)).rejects.toThrow("disabled");
    f.connection.writesEnabled = true;
    f.proposal.expiresAt = "2026-10-30T00:00:00Z";
    await expect(run(apply, f.dependencies)).rejects.toThrow("expired");
    f.proposal.changes.caption = "Unreviewed caption";
    await expect(run(apply, f.dependencies)).rejects.toThrow("not a valid");
    expect(f.requests.every(item => item.method === "GET")).toBe(true);
  });

  it("inspects completed same-ID executions without another Apply even after writes are disabled", async () => {
    const f = fixture();
    f.connection.writesEnabled = true;
    await run(apply, f.dependencies);
    const completedAt = f.requests.length;
    f.connection.writesEnabled = false;
    await run(apply, f.dependencies);
    expect(f.requests.filter(item => item.method === "POST")).toHaveLength(1);
    expect(f.requests.slice(completedAt)).toEqual([
      { method: "GET", path: "/api/wordpress/businesses/example/connection", body: undefined },
      { method: "GET", path: `/api/wordpress/businesses/example/proposals/${proposalId}`, body: undefined },
    ]);
  });

  it("only inspects an execution marker without an outcome, never sending Apply", async () => {
    const f = fixture();
    f.connection.writesEnabled = true;
    f.proposal.executionStarted = true;
    expect((await run(apply, f.dependencies)).mode).toBe("inspect");
    expect(f.requests.every(item => item.method === "GET")).toBe(true);
  });

  it("after a lost Apply response reads the original receipt once and never retries or restores", async () => {
    const f = fixture();
    f.connection.writesEnabled = true;
    const original = f.transport.getMockImplementation()!;
    let dispatches = 0;
    f.transport.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/apply")) { dispatches++; throw new Error(`untrusted failure ${key}`); }
      return original(input, init);
    });
    const result = await run(apply, f.dependencies);
    expect(result.status).toBe("outcome_unknown");
    expect(dispatches).toBe(1);
    expect(f.requests.filter(item => item.path.endsWith(`/proposals/${proposalId}`))).toHaveLength(2);
    expect(JSON.stringify(f.output.mock.calls)).not.toContain(key);
  });

  it("inspect makes only GETs and does not require writes enabled", async () => {
    const f = fixture();
    expect((await run(inspect, f.dependencies)).mode).toBe("inspect");
    expect(f.requests).toHaveLength(2);
    expect(f.requests.every(item => item.method === "GET")).toBe(true);
  });
});
