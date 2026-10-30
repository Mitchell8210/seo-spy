import { loadBuffer } from "cheerio";
import { randomUUID } from "node:crypto";
import type {
  AuditResults,
  Evidence,
  Finding,
  Recommendation,
  Score,
} from "../../contracts/domain.js";
import type { CollectedPage } from "./collector.js";

export const HOMEPAGE_NOTICE =
  "Homepage HTML audit only. JavaScript, browser performance, Facebook, and search rankings were not assessed. Scores are unavailable.";

export function analyzeHomepage(
  page: CollectedPage,
  auditId: string,
): AuditResults {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(page.contentType)?.[1];
  const $ = loadBuffer(page.body, {
    encoding: { transportLayerEncodingLabel: charset },
  });
  const text = (value: string) => value.replace(/\s+/g, " ").trim();
  const evidence: Evidence[] = [];
  const findings: Finding[] = [];
  const recommendations: Recommendation[] = [];
  function record(
    checkId: string,
    observed: Record<string, string>,
    issue?: { title: string; change: string; explanation: string },
  ) {
    const item: Evidence = {
      id: randomUUID(),
      auditId,
      checkId,
      sourceUrl: page.finalUrl,
      collectedAt: page.collectedAt,
      mode: "live",
      observed,
    };
    evidence.push(item);
    if (!issue) return;
    const finding: Finding = {
      id: randomUUID(),
      auditId,
      checkId,
      evidenceIds: [item.id],
      severity: "low",
      source: "website",
      title: issue.title,
      explanation: issue.explanation,
      status: "needs_review",
    };
    findings.push(finding);
    recommendations.push({
      id: randomUUID(),
      auditId,
      findingId: finding.id,
      title: issue.title,
      explanation: issue.explanation,
      recommendedChange: issue.change,
      purpose: "Improve homepage metadata or document clarity.",
      status: "needs_review",
    });
  }
  record("collection", {
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    status: String(page.status),
    contentType: page.contentType,
    bytes: String(page.bytes),
    redirects: JSON.stringify(page.redirects),
  });
  const titles = $("title")
    .toArray()
    .map((el) => text($(el).text()));
  record(
    "page-title",
    { values: JSON.stringify(titles) },
    titles.length !== 1 || !titles[0]
      ? {
          title: "Review the homepage title",
          change: "Provide one descriptive, nonempty title for the homepage.",
          explanation:
            "The collected HTML does not contain exactly one nonempty title.",
        }
      : undefined,
  );
  const descriptions = $("meta")
    .toArray()
    .filter((el) => $(el).attr("name")?.toLowerCase() === "description")
    .map((el) => text($(el).attr("content") ?? ""));
  record(
    "meta-description",
    { values: JSON.stringify(descriptions) },
    descriptions.length !== 1 || !descriptions[0]
      ? {
          title: "Review the meta description",
          change: "Provide one useful, nonempty homepage meta description.",
          explanation:
            "The collected HTML does not contain exactly one nonempty meta description.",
        }
      : undefined,
  );
  const headings = $("h1,h2,h3,h4,h5,h6")
    .toArray()
    .map((el) => ({ level: el.tagName, text: text($(el).text()) }));
  const h1s = headings.filter((h) => h.level === "h1");
  record(
    "headings",
    { values: JSON.stringify(headings), h1Count: String(h1s.length) },
    h1s.length !== 1 || !h1s[0]?.text
      ? {
          title: "Review the main heading",
          change: "Use a clear main heading that describes the page.",
          explanation:
            "The collected HTML has missing, empty, or multiple H1 headings. Review the document structure in context.",
        }
      : undefined,
  );
  let base = page.finalUrl;
  try {
    base = new URL(
      $("base[href]").first().attr("href") ?? page.finalUrl,
      page.finalUrl,
    ).href;
  } catch {
    /* Invalid base; use fetched URL. */
  }
  const canonicals = $("link")
    .toArray()
    .filter((el) =>
      ($(el).attr("rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .includes("canonical"),
    )
    .map((el) => $(el).attr("href") ?? "");
  let canonical: string | null = null;
  try {
    if (canonicals[0]?.trim()) {
      const target = new URL(canonicals[0], base);
      if (["http:", "https:"].includes(target.protocol))
        canonical = target.href;
    }
  } catch {
    /* Report invalid canonical below. */
  }
  record(
    "canonical",
    {
      values: JSON.stringify(canonicals),
      resolved: canonical ?? "",
      finalUrl: page.finalUrl,
    },
    canonicals.length !== 1 || canonical !== page.finalUrl
      ? {
          title: "Review the canonical URL",
          change:
            "Confirm the preferred homepage URL and provide one valid canonical link to it.",
          explanation:
            "The canonical is missing, invalid, duplicated, or differs from the fetched URL. A different canonical can be intentional.",
        }
      : undefined,
  );
  const robots = $("meta")
    .toArray()
    .filter((el) =>
      ["robots", "googlebot"].includes(
        ($(el).attr("name") ?? "").toLowerCase(),
      ),
    )
    .map((el) => $(el).attr("content") ?? "");
  record(
    "robots",
    { meta: JSON.stringify(robots), header: page.robots },
    /\b(noindex|none)\b/i.test([...robots, page.robots].join(","))
      ? {
          title: "Review indexing restrictions",
          change:
            "Confirm whether homepage indexing restrictions are intentional before changing them.",
          explanation:
            "A robots meta tag or X-Robots-Tag header contains noindex or none. This audit does not check robots.txt or actual search indexing.",
        }
      : undefined,
  );
  const images = $("img")
    .toArray()
    .map((el) => ({
      src: $(el).attr("src") ?? "",
      alt: $(el).attr("alt") ?? null,
    }));
  const missing = images.filter((image) => image.alt === null);
  const empty = images.filter(
    (image) => image.alt !== null && !image.alt.trim(),
  );
  record(
    "image-alt",
    {
      count: String(images.length),
      missingCount: String(missing.length),
      emptyCount: String(empty.length),
      values: JSON.stringify(images),
    },
    missing.length || empty.length
      ? {
          title: "Review image alternatives",
          change:
            "Add descriptive alt text to informative images; keep empty alt text for decorative images.",
          explanation: `${missing.length} images lack an alt attribute and ${empty.length} have empty alt text. Empty alt text can be appropriate for decorative images and requires contextual review.`,
        }
      : undefined,
  );
  const scores: Score[] = (
    ["website", "social", "consistency", "overall"] as const
  ).map((category) => ({
    category,
    value: null,
    maximum: 100,
    availability: "unavailable",
    scoringVersion: "homepage-v1",
  }));
  return { evidence, findings, recommendations, scores };
}
