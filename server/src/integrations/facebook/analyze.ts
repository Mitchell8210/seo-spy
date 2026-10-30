import { createHash } from "node:crypto";
import type {
  Evidence,
  Finding,
  Recommendation,
} from "../../contracts/domain.js";
import type { FacebookMetric, FacebookReport } from "./types.js";

export interface FacebookAnalysis {
  version: "facebook-analysis-v1";
  auditId: string;
  summaries: string[];
  findings: Finding[];
  recommendations: Recommendation[];
}

const DAY = 86400000;
const format = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const stableId = (auditId: string, checkId: string, kind: string) => {
  const hex = createHash("sha256")
    .update(`facebook-analysis-v1:${auditId}:${checkId}:${kind}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

function normalizedPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national =
    digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? national : null;
}
function formatPhone(phone: string): string {
  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
}
function postPhones(message: string): string[] {
  // Require phone-like separators in posts: a ten-digit identifier is not enough.
  const pattern =
    /(?<![\p{L}\d])(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)[ .-]?|[2-9]\d{2}[ .-])[2-9]\d{2}[ .-]\d{4}(?![\p{L}\d])/gu;
  return [...message.slice(0, 20000).matchAll(pattern)]
    .slice(0, 10)
    .flatMap((match) => {
      const phone = normalizedPhone(match[0]);
      return phone ? [phone] : [];
    });
}
function measuredPoints(metric: FacebookMetric | undefined) {
  if (metric?.status !== "available") return [];
  return metric.points
    .filter(
      (point) =>
        Number.isFinite(point.value) &&
        point.value >= 0 &&
        Number.isFinite(Date.parse(point.endTime)),
    )
    .slice()
    .sort((a, b) => a.endTime.localeCompare(b.endTime));
}

/** Derive review suggestions from a dated immutable report without changing its evidence. */
export function analyzeFacebook(
  report: FacebookReport,
  auditId: string,
  evidence: Evidence[],
): FacebookAnalysis {
  const analysis: FacebookAnalysis = {
    version: "facebook-analysis-v1",
    auditId,
    summaries: [],
    findings: [],
    recommendations: [],
  };
  const sources = (checkIds: string[]) => [
    ...new Set(
      evidence
        .filter(
          (item) =>
            item.auditId === auditId &&
            item.mode === "live" &&
            checkIds.includes(item.checkId),
        )
        .map((item) => item.id),
    ),
  ];
  const review = (
    checkId: string,
    evidenceChecks: string[],
    title: string,
    explanation: string,
    recommendedChange: string,
    purpose: string,
    severity: Finding["severity"] = "low",
  ) => {
    const evidenceIds = sources(evidenceChecks);
    if (!evidenceIds.length) return;
    const findingId = stableId(auditId, checkId, "finding");
    analysis.findings.push({
      id: findingId,
      auditId,
      checkId,
      evidenceIds,
      severity,
      source: "facebook",
      title,
      explanation,
      status: "needs_review",
    });
    analysis.recommendations.push({
      id: stableId(auditId, checkId, "recommendation"),
      auditId,
      findingId,
      title,
      explanation,
      recommendedChange,
      purpose,
      status: "needs_review",
    });
  };

  for (const [name, label] of [
    ["about", "About description"],
    ["website", "website"],
    ["phone", "phone number"],
    ["hours", "business hours"],
    ["username", "username"],
  ] as const) {
    if (report.profile[name]?.status !== "missing") continue;
    review(
      `facebook:profile:${name}`,
      [`facebook:profile:${name}`],
      `Review the Page's ${label}`,
      `Meta did not return a populated ${label} field. This does not establish whether it is absent from the visible Page.`,
      `Check the ${label} shown on Facebook and add or correct it if appropriate.`,
      "Help visitors find current business information.",
    );
  }

  const asOf = Date.parse(report.collectedAt);
  const posts =
    report.posts.status === "available" ? report.posts.items.slice(0, 50) : [];
  const validDated = posts.filter(
    (post) =>
      post.createdTime !== null &&
      Number.isFinite(Date.parse(post.createdTime)) &&
      Date.parse(post.createdTime) <= asOf,
  );
  const latest = validDated
    .slice()
    .sort((a, b) => a.createdTime!.localeCompare(b.createdTime!))
    .at(-1);
  if (Number.isFinite(asOf) && latest?.createdTime) {
    const days = Math.floor((asOf - Date.parse(latest.createdTime)) / DAY);
    const description = `The newest of ${posts.length} collected posts was dated ${latest.createdTime.slice(0, 10)}, ${days} day${days === 1 ? "" : "s"} before collection.`;
    analysis.summaries.push(description);
    if (days >= 30 && validDated.length === posts.length) {
      review(
        "facebook:posting-inactivity",
        ["facebook:posts"],
        "Review recent posting activity",
        `${description} This describes the collected posts; API visibility and collection limits may differ from the public Page.`,
        "Review your visible Page activity and plan useful updates for customers if appropriate. Older content may still be relevant.",
        "Keep customers informed about current services and availability.",
      );
    }
  } else if (report.posts.status === "available" && !posts.length) {
    analysis.summaries.push(
      "No posts were returned. API visibility and collection limits do not establish whether the public Page has posts.",
    );
  } else {
    analysis.summaries.push(
      "The latest posting date could not be established from the collected data.",
    );
  }
  if (report.posts.truncated)
    analysis.summaries.push(
      "Post collection is limited; this report is not a complete publishing history.",
    );

  const phone = report.profile.phone;
  const profilePhone =
    phone?.status === "available" && typeof phone.value === "string"
      ? normalizedPhone(phone.value)
      : null;
  const occurrences = posts.flatMap((post) =>
    post.message
      ? postPhones(post.message).map((number) => ({
          number,
          id: post.id,
          date: post.createdTime?.slice(0, 10) ?? "date unavailable",
        }))
      : [],
  );
  const distinct = [
    ...new Set([
      ...(profilePhone ? [profilePhone] : []),
      ...occurrences.map((item) => item.number),
    ]),
  ].slice(0, 10);
  if (distinct.length > 1 && occurrences.length) {
    const examples = occurrences
      .filter(
        (item, index) =>
          occurrences.findIndex(
            (candidate) => candidate.number === item.number,
          ) === index,
      )
      .slice(0, 6)
      .map(
        (item) =>
          `${formatPhone(item.number)} in post ${item.id} (${item.date})`,
      )
      .join("; ");
    review(
      "facebook:phone-consistency",
      ["facebook:posts", ...(profilePhone ? ["facebook:profile:phone"] : [])],
      "Review inconsistent phone numbers",
      `Different phone numbers were found in the collected Page/post data: ${distinct.map(formatPhone).join(", ")}.${profilePhone ? ` The Page phone field lists ${formatPhone(profilePhone)}.` : ""} Examples: ${examples}. Older posts may contain historical contact details; this check does not determine which number is correct.`,
      "Confirm the current contact number, review the identified posts, and correct outdated numbers where appropriate. Different service lines may be intentional.",
      "Help customers contact the intended business number.",
      "medium",
    );
  }

  const followerMetric = report.metrics.find(
    (metric) => metric.name === "page_follows",
  );
  const followers = measuredPoints(followerMetric);
  if (followers.length) {
    const first = followers[0]!,
      last = followers.at(-1)!;
    analysis.summaries.push(
      followers.length > 1
        ? `Follower snapshots changed from ${format(first.value)} (${first.endTime.slice(0, 10)}) to ${format(last.value)} (${last.endTime.slice(0, 10)}): ${last.value - first.value >= 0 ? "+" : ""}${format(last.value - first.value)} across ${followers.length} returned daily snapshots.`
        : `One follower snapshot was returned: ${format(first.value)} (${first.endTime.slice(0, 10)}). A change cannot be established from one snapshot.`,
    );
  } else
    analysis.summaries.push(
      "Follower history is unavailable; no growth or decline can be established.",
    );

  const labels: Record<string, string> = {
    page_media_view: "Media views",
    page_views_total: "Page views",
    page_post_engagements: "Post engagements",
    page_video_views: "Video views",
    page_daily_follows_unique: "Daily follows",
    page_daily_unfollows_unique: "Daily unfollows",
  };
  for (const [name, label] of Object.entries(labels)) {
    const metric = report.metrics.find((item) => item.name === name);
    const points = measuredPoints(metric);
    if (!metric || metric.aggregation !== "sum" || !points.length) {
      analysis.summaries.push(`${label}: unavailable in the returned data.`);
      continue;
    }
    const total = points.reduce((sum, point) => sum + point.value, 0);
    analysis.summaries.push(
      `${label}: ${format(total)} across ${points.length} returned daily measurements.`,
    );
  }
  analysis.summaries.push(
    "Metric totals cover returned daily measurements only. Meta period boundaries may differ from the requested window, and the latest period may be incomplete. Daily unique follows/unfollows are summed events across days, not distinct people across the full period.",
  );
  return analysis;
}
