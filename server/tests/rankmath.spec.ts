import { collectRankMathEvidence, runRankMathAudit, type RankMathRead } from "../src/integrations/wordpress/rankmath.js";

const definition = (name: string, readonly = true) => ({ name: `rank-math/${name}`, meta: { annotations: { readonly } } });
function fixture() {
  const calls: { path: string; method: string | undefined }[] = [];
  const values: Record<string, unknown> = {
    "/wp/v2/plugins?context=edit": [{ plugin: "seo-by-rank-math/rank-math", version: "1.0.277.2", status: "active" }, { plugin: "unrelated/private-plugin", version: "secret", status: "active" }],
    "/wp-abilities/v1/abilities/rank-math/get-post-seo-meta": definition("get-post-seo-meta"),
    "/wp-abilities/v1/abilities/rank-math/get-seo-scores": definition("get-seo-scores"),
    "/wp-abilities/v1/abilities/rank-math/audit-site-seo": definition("audit-site-seo"),
    "get-post-seo-meta/run": { post_id: 12, title: "SEO title", description: "Description", robots: ["index"], seo_score: 0, private_token: "DO_NOT_RETURN" },
    "get-seo-scores/run": [{ post_id: 12, title: "Page", keyword: null, score: 0, grade: "bad", last_updated: 1793354400 }],
    "audit-site-seo/run": { score: 0, last_run_at: 1793354400, remote_api_status: "ok", findings: [{ test_id: "title", status: "fail", category: "basic", title: "Review title", description: "The title needs review.", fix_text: "Inspect the observed title.", fix_html: "<script>unsafe()</script>" }] },
  };
  const read: RankMathRead = async (path, method) => {
    calls.push({ path, method });
    const key = Object.keys(values).find(key => key.includes("/run") ? path.includes(key) : path === key);
    if (!key) throw new Error("private provider detail");
    return values[key];
  };
  return { values, calls, read };
}

describe("Rank Math evidence adapter", () => {
  it("discovers all abilities through a transport limited to two concurrent requests", async () => {
    const f = fixture();
    let active = 0;
    const bounded: RankMathRead = async (path, method) => {
      if (active >= 2) throw new Error("WORDPRESS_BUSY");
      active++;
      try {
        await new Promise(resolve => setTimeout(resolve, 1));
        return await f.read(path, method);
      } finally { active--; }
    };
    const report = await collectRankMathEvidence(bounded, { contentType: "pages", contentId: 12 });
    expect(report.abilities).toHaveLength(3);
    expect(report.abilities.every(ability => ability.available)).toBe(true);
    expect(report.siteAudit.canRequest).toBe(true);
  });

  it("retrieves actual stored zero scores and metadata without running a site audit or exposing unrelated data", async () => {
    const f = fixture();
    const report = await collectRankMathEvidence(f.read, { contentType: "pages", contentId: 12 });
    expect(report.availability).toBe("available");
    expect(report.plugin).toMatchObject({ edition: "free", versions: [{ plugin: "seo-by-rank-math/rank-math", version: "1.0.277.2", active: true }] });
    expect(report.content).toMatchObject({ contentId: 12, source: "ability", storedSeoScore: 0, metadata: { title: "SEO title", robots: ["index"] } });
    expect(report.scores.items[0]?.storedSeoScore).toBe(0);
    expect(report.scores.items[0]?.contentModifiedAt).not.toBeNull();
    expect(report.siteAudit).toMatchObject({ availability: "unavailable", canRequest: true });
    expect(f.calls.every(call => call.method === "GET")).toBe(true);
    expect(f.calls.some(call => call.path.includes("audit-site-seo/run"))).toBe(false);
    expect(f.calls.find(call => call.path.includes("get-post-seo-meta/run"))?.path).toBe("/wp-abilities/v1/abilities/rank-math/get-post-seo-meta/run?input%5Bpost_id%5D=12");
    expect(f.calls.find(call => call.path.includes("get-seo-scores/run"))?.path).toBe("/wp-abilities/v1/abilities/rank-math/get-seo-scores/run?input%5Bnumber_of_posts%5D=10&input%5Bpost_type%5D=page");
    expect(JSON.stringify(report)).not.toMatch(/DO_NOT_RETURN|private-plugin|unsafe/);
  });

  it("falls back only to explicitly exposed registered meta and preserves unavailable versus zero", async () => {
    const f = fixture();
    f.values["/wp-abilities/v1/abilities/rank-math/get-post-seo-meta"] = null;
    f.values["/wp/v2/posts/12?context=edit&_fields=id,meta"] = { id: 12, meta: { rank_math_seo_score: "0", rank_math_title: "", _elementor_data: "private content" } };
    const report = await collectRankMathEvidence(f.read, { contentType: "posts", contentId: 12 });
    expect(report.content).toMatchObject({ source: "registered-meta", metadata: { title: "" }, storedSeoScore: 0 });
    expect(JSON.stringify(report)).not.toContain("private content");
    f.values["/wp/v2/posts/12?context=edit&_fields=id,meta"] = { id: 12, meta: {} };
    const unknown = await collectRankMathEvidence(f.read, { contentType: "posts", contentId: 12 });
    expect(unknown.content.availability).toBe("unavailable");
    expect(unknown.content.storedSeoScore).toBeNull();
  });

  it("does not misrepresent Rank Math's metadata default zero as an established stored score", async () => {
    const f = fixture();
    f.values["get-seo-scores/run"] = [{ post_id: 12, score: null, grade: "na" }];
    expect((await collectRankMathEvidence(f.read, { contentType: "pages", contentId: 12 })).content.storedSeoScore).toBeNull();
    f.values["get-seo-scores/run"] = [{ post_id: 99, score: 0 }];
    expect((await collectRankMathEvidence(f.read, { contentType: "pages", contentId: 12 })).content.storedSeoScore).toBeNull();
  });

  it("rejects mismatched content ownership, invalid scores and changed ability semantics", async () => {
    const f = fixture();
    f.values["get-post-seo-meta/run"] = { post_id: 99, seo_score: 90 };
    f.values["get-seo-scores/run"] = [{ post_id: 12, score: 200 }];
    const report = await collectRankMathEvidence(f.read, { contentType: "pages", contentId: 12 });
    expect(report.content.availability).toBe("unavailable");
    expect(report.scores.items[0]?.storedSeoScore).toBeNull();
    f.values["/wp-abilities/v1/abilities/rank-math/get-seo-scores"] = definition("get-seo-scores", false);
    f.calls.length = 0;
    expect((await collectRankMathEvidence(f.read, { contentType: "pages" })).scores.availability).toBe("unavailable");
    expect(f.calls.some(call => call.path.includes("get-seo-scores/run"))).toBe(false);
  });

  it("does not guess a score, plugin edition or passing checks when access fails", async () => {
    const report = await collectRankMathEvidence(async () => { throw new Error("secret failure"); }, { contentType: "pages", contentId: 12 });
    expect(report.availability).toBe("unavailable");
    expect(report.plugin.edition).toBe("unknown");
    expect(report.scores.items).toEqual([]);
    expect(report.content.storedSeoScore).toBeNull();
    expect(report.siteAudit.canRequest).toBe(false);
    expect(JSON.stringify(report)).not.toContain("secret failure");
  });

  it("identifies an active Pro add-on without claiming the account's subscription tier", async () => {
    const f = fixture();
    (f.values["/wp/v2/plugins?context=edit"] as unknown[]).push({ plugin: "seo-by-rank-math-pro/rank-math-pro", version: "3.0.test", status: "active" });
    expect((await collectRankMathEvidence(f.read, { contentType: "pages" })).plugin.edition).toBe("pro-addon");
  });

  it("bounds user-selected content targets and sample sizes before any read", async () => {
    const f = fixture();
    await expect(collectRankMathEvidence(f.read, { contentType: "pages", contentId: -1 })).rejects.toThrow("Invalid Rank Math evidence target");
    await expect(collectRankMathEvidence(f.read, { contentType: "pages", limit: 101 })).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });
});

describe("explicit Rank Math audit operation", () => {
  it("requests a fresh audit only through its separate helper and keeps provider score distinct", async () => {
    const f = fixture();
    const report = await runRankMathAudit(f.read);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]?.path).toBe("/wp-abilities/v1/abilities/rank-math/audit-site-seo/run?input%5Brefresh%5D=true");
    expect(report).toMatchObject({ provider: "rank-math", availability: "available", score: 0, remoteApiStatus: "ok" });
    expect(report.findings).toEqual([{ testId: "title", category: "basic", status: "fail", title: "Review title", description: "The title needs review.", fixText: "Inspect the observed title." }]);
    expect(JSON.stringify(report)).not.toContain("<script>");
  });

  it("preserves local findings when remote analysis fails and never turns no checks into a pass", async () => {
    const f = fixture();
    const value = f.values["audit-site-seo/run"] as Record<string, unknown>;
    value.remote_api_status = "unavailable";
    value.error = { code: "provider_failed", message: "secret" };
    expect((await runRankMathAudit(f.read)).availability).toBe("partial");
    value.findings = [];
    const empty = await runRankMathAudit(f.read);
    expect(empty.availability).toBe("unavailable");
    expect(empty.score).toBeNull();
    expect(JSON.stringify(empty)).not.toContain("secret");
  });

  it("does not execute a missing or semantically changed audit ability", async () => {
    const f = fixture();
    f.values["/wp-abilities/v1/abilities/rank-math/audit-site-seo"] = definition("audit-site-seo", false);
    expect((await runRankMathAudit(f.read)).availability).toBe("unavailable");
    expect(f.calls).toHaveLength(1);
  });
});
