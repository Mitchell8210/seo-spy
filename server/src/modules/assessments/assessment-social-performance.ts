import type { Business, Evidence } from "../../contracts/domain.js";
import { isDeepStrictEqual } from "node:util";
import type { AuditReportRecord } from "../../reports/report.types.js";
import type { FacebookMetric } from "../../integrations/facebook/types.js";
import { aggregateFacebookDailyValues, createFacebookReportingWindow } from "../../integrations/facebook/reporting-window.js";
import { verifyFacebookSocialHistory } from "../../integrations/facebook/social-history.js";
import { derive90DayPostMeasurements, descriptionSignalCount } from "../../scoring/social-post-measurements.js";
import type { ScoreCriterion, ScoreEvidenceRef } from "../../scoring/scoring.types.js";
import type { SocialCriterionId, SocialCriterionInput, SocialPerformanceInput } from "../../scoring/social-performance.types.js";

const fresh = (value: string, cutoff: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(cutoff) && Date.parse(cutoff) - Date.parse(value) <= 7 * 86400000;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

/** Pure adapter over one immutable authorized report. No provider, message-content read or guessed absence. */
export function buildSocialPerformanceInput(business: Business, report: AuditReportRecord, cutoff: string, profileCriteria: ScoreCriterion[]): SocialPerformanceInput {
  if (report.business.id !== business.id || report.audit.businessId !== business.id || report.audit.id !== report.reportId || report.auditId !== report.reportId
    || report.audit.mode !== "live" || report.audit.scope !== "facebook" || !["completed", "partial"].includes(report.audit.status)
    || !report.results?.facebook || new URL(report.business.website).href !== new URL(business.website).href) throw new Error("Social evidence does not belong to the selected business and report.");
  const fb = report.results!.facebook!, evidence = report.results!.evidence;
  const input: SocialPerformanceInput = { businessId: business.id, pageId: fb.pageId, reportId: report.reportId, collectedAt: fb.collectedAt, cutoff,
    evidenceIds: evidence.map(item => item.id), criteria: {} };
  const owned = (item: Evidence) => item.auditId === report.reportId && item.mode === "live" && item.sourceUrl === `https://www.facebook.com/${fb.pageId}` && fresh(item.collectedAt, cutoff);
  const find = (checkId: string) => { const matches = evidence.filter(item => item.checkId === checkId && owned(item)); return matches.length === 1 ? matches[0] : undefined; };
  const refs = (items: Evidence[]): ScoreEvidenceRef[] => items.map(item => ({ reportId: report.reportId, evidenceId: item.id }));
  const available = (value: number, items: Evidence[], dates: string | string[], explanation: string): SocialCriterionInput => ({ status: "available", value, evidence: refs(items),
    collectedAt: new Date(Math.min(...[...(Array.isArray(dates) ? dates : [dates]), ...items.map(item => item.collectedAt)].map(Date.parse))).toISOString(), complete: true, explanation });
  const unavailable = (id: SocialCriterionId, reason: string, explanation: string) => { input.criteria[id] = { status: "unavailable", value: null, evidence: [], collectedAt: fb.collectedAt, complete: false, reason, explanation }; };
  const field = (name: string) => {
    const item = fb.profile[name], proof = find(`facebook:profile:${name}`);
    if (!item || item.status !== "available" || !fresh(item.collectedAt, cutoff) || !proof || proof.observed.status !== item.status) return null;
    try { if (!same(JSON.parse(proof.observed.value ?? "null"), item.value)) return null; } catch { return null; }
    return { item, proof };
  };
  const oldIds: Record<string, SocialCriterionId> = { "business-name": "profile-name", description: "profile-description", "website-link": "profile-website", "contact-route": "profile-contact", category: "profile-category" };
  for (const [id, target] of Object.entries(oldIds)) {
    unavailable(target, "PROFILE_FIELD_NOT_VERIFIED", "API omission does not establish a visibly missing profile field.");
    const criterion = profileCriteria.find(item => item.id === id);
    if (criterion?.outcome === "fail" && criterion.confirmation === "confirmed-absence") {
      const cited = criterion.evidence.flatMap(ref => evidence.filter(item => item.id === ref.evidenceId && ref.reportId === report.reportId && owned(item)));
      if (cited.length === criterion.evidence.length && cited.length > 0) input.criteria[target] = available(0, cited, cited[0]!.collectedAt, "The field's visible absence was explicitly confirmed against this saved report.");
    }
  }
  for (const [name, id] of [["name", "profile-name"], ["category", "profile-category"]] as const) {
    const source = field(name);
    if (source && text(source.item.value)) input.criteria[id] = available(1, [source.proof], source.item.collectedAt, "A populated field is verified. Semantic accuracy and business agreement are separate checks.");
  }
  const descriptions = [field("about"), field("description")].filter(item => item !== null && text(item.item.value));
  if (descriptions.length) input.criteria["profile-description"] = available(Math.max(...descriptions.map(item => descriptionSignalCount(item!.item.value as string))), descriptions.map(item => item!.proof), descriptions.map(item => item!.item.collectedAt),
    "Presence earns one signal; a supported text pattern for a service, resource or next step earns a second. These English/Spanish structural cues do not prove semantic writing quality.");
  const website = field("website");
  if (website && text(website.item.value)) {
    let valid = false;
    try { const parsed = new URL(website.item.value.trim()); valid = ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !/[\r\n]/.test(website.item.value); } catch { /* Verified malformed syntax earns zero, not an invented absence. */ }
    input.criteria["profile-website"] = available(Number(valid), [website.proof], website.item.collectedAt, "HTTP(S) URL syntax is checked; destination ownership, public accessibility and conversion performance are not inferred.");
  }
  const phone = field("phone"), email = field("emails");
  const phoneValid = phone && text(phone.item.value) && /^[+\d\s().-]+$/.test(phone.item.value) && phone.item.value.replace(/\D/g, "").length >= 7 && phone.item.value.replace(/\D/g, "").length <= 15;
  const emailValid = email && Array.isArray(email.item.value) && email.item.value.some(item => typeof item === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  if (phoneValid || emailValid) {
    const chosen = phoneValid ? phone! : email!;
    input.criteria["profile-contact"] = available(1, [chosen.proof], chosen.item.collectedAt, "A syntactically valid phone or email is verified; availability and response quality are not inferred.");
  } else if (phone && email) input.criteria["profile-contact"] = available(0, [phone.proof, email.proof], [phone.item.collectedAt, email.item.collectedAt], "Returned contact fields contain no syntactically valid contact route.");

  const historyProof = find("facebook:social-history");
  const history = verifyFacebookSocialHistory(fb.socialHistory, historyProof?.observed ?? null, fb.pageId, cutoff);
  const postingIds: SocialCriterionId[] = ["posts-per-week", "posting-recency-days", "active-week-ratio", "longest-gap-days"];
  const contentIds: SocialCriterionId[] = ["actionable-post-ratio", "observable-structure-count", "distinct-post-ratio"];
  for (const id of [...postingIds, ...contentIds]) unavailable(id, history.reason, "Complete, timestamped and hash-bound 90-day post evidence is required. A recent-post sample or 28-day proof is insufficient.");
  if (history.complete && historyProof && history.since && history.until && history.observedAt) {
    const values = derive90DayPostMeasurements(history.items, history.since, history.until, history.contentComplete);
    for (const id of [...postingIds, ...contentIds]) {
      const value = values[id];
      if (value !== undefined) input.criteria[id] = available(value, [historyProof], history.observedAt,
        `${history.items.length} accessible Page posts; ${history.since} to ${history.until} (90 completed UTC days). ${postingIds.includes(id) ? "Frequency, recency, full-week distribution and boundary-inclusive inactivity are calculated from verified timestamps." : "Text structure and exact repetition are deterministic proxies; they do not establish factual accuracy, relevance or visual quality."}`);
      else unavailable(id, "CONTENT_NOT_FULLY_OBSERVED", "No complete non-empty text sample is established. Media-only, omitted and unretained text are not assessed as poor content.");
    }
  }

  const expected = createFacebookReportingWindow(new Date(fb.collectedAt));
  const windowMatches = fb.window.since === expected.since && fb.window.until === expected.until && fb.window.requestedDays === 30 && fb.window.timeZone === expected.timeZone && fb.window.basis === expected.basis;
  const metric = (name: string): { value: number; proof: Evidence; metric: FacebookMetric } | null => {
    const candidates = fb.metrics.filter(item => item.name === name), item = candidates[0], proof = find(`facebook:insight:${name}`);
    if (!windowMatches || candidates.length !== 1 || !item || !proof || proof.observed.status !== "available" || proof.observed.requestedSince !== expected.since || proof.observed.requestedUntil !== expected.until
      || item.status !== "available" || item.period !== "day" || item.aggregation !== "sum" || !count(item.total) || !fresh(item.collectedAt, cutoff)
      || !item.coverage?.complete || item.coverage.expectedDays !== 30 || item.coverage.returnedDays !== 30 || item.points.length !== 30) return null;
    try { if (!same(JSON.parse(proof.observed.metric ?? "null"), item)) return null; } catch { return null; }
    const isLike = name === "page_post_likes";
    if (item.sourceMetric !== (isLike ? "page_actions_post_reactions_total" : name) || isLike && item.breakdown !== "like") return null;
    const verified = aggregateFacebookDailyValues({ data: [{ name: item.sourceMetric, period: "day", values: item.points.map(point => ({ end_time: point.endTime, value: isLike ? { like: point.value } : point.value })) }] }, item.sourceMetric, expected, isLike ? "like" : undefined);
    return verified.status === "available" && verified.total === item.total && same(verified.points, item.points) ? { value: item.total, proof, metric: item } : null;
  };
  const followers = field("followers_count");
  const denominator = followers && count(followers.item.value) && followers.item.value > 0 ? followers.item.value : null;
  const likes = metric("page_post_likes"), views = metric("page_media_view");
  const comments = fb.commentCounts, commentProof = find("facebook:comment-counts");
  let commentsVerified = false;
  try { commentsVerified = !!(windowMatches && comments && commentProof && comments.status === "available" && comments.complete && count(comments.total)
    && comments.total === comments.observedTotal && comments.postsCollected === comments.postsChecked && comments.since === expected.since && comments.until === expected.until && comments.timeZone === expected.timeZone
    && fresh(comments.collectedAt, cutoff) && same(JSON.parse(commentProof.observed.summary ?? "null"), comments)); } catch { /* Malformed summaries remain unknown. */ }
  for (const id of ["likes-per-100-followers", "comments-per-100-followers", "media-views-per-follower"] as const) unavailable(id, denominator === null ? "POSITIVE_FOLLOWER_DENOMINATOR_REQUIRED" : "COMPLETE_PERIOD_METRIC_REQUIRED", "A positive verified current follower count and complete compatible 30-day action evidence are required; a zero numerator is valid.");
  if (denominator !== null && followers) {
    if (likes) input.criteria["likes-per-100-followers"] = available(likes.value * 100 / denominator, [likes.proof, followers.proof], [likes.metric.collectedAt, followers.item.collectedAt],
      `${likes.value} LIKE actions / ${denominator} current followers × 100; ${expected.since} to ${expected.until}. Not all reactions, unique engaged people or per-post engagement; non-followers and repeat actions can contribute. Small audiences can produce volatile ratios.`);
    if (commentsVerified && comments && commentProof) input.criteria["comments-per-100-followers"] = available(comments.total! * 100 / denominator, [commentProof, followers.proof], [comments.collectedAt, followers.item.collectedAt],
      `${comments.total} accessible comments/replies / ${denominator} current followers × 100; ${expected.since} to ${expected.until}. Includes activity on older posts and may include business-authored replies; this is action density, not unique customer engagement.`);
    if (views) input.criteria["media-views-per-follower"] = available(views.value / denominator, [views.proof, followers.proof], [views.metric.collectedAt, followers.item.collectedAt],
      `${views.value} non-unique media views / ${denominator} current followers; ${expected.since} to ${expected.until}. Not unique reach; ads and repeat views may contribute. Page views and video views are not added to this measure.`);
  }
  unavailable("shares-per-100-followers", "PERIOD_SHARE_EVENTS_UNAVAILABLE", "Lifetime Shares and empty sharedposts edges do not establish a complete timestamped 30-day share total.");
  unavailable("follower-growth-percent", "ALIGNED_FOLLOWER_SNAPSHOTS_REQUIRED", "No verified follower snapshots at both exact reporting boundaries are established. Daily unique follows/unfollows and first/last returned snapshots do not prove exact 30-day audience growth.");
  unavailable("reviewed-relevance", "SUPPORTED_CONTENT_REVIEW_REQUIRED", "Text patterns cannot establish service relevance, factual accuracy or substantive usefulness. A supported review is an extension point; no model was called.");
  unavailable("customer-response-rate", "PAIRED_INQUIRY_RESPONSE_EVIDENCE_REQUIRED", "A new conversation count does not establish eligible inquiries or business response coverage.");
  unavailable("customer-response-hours", "PAIRED_INQUIRY_RESPONSE_EVIDENCE_REQUIRED", "No verified paired inquiry/response timestamps or response-time distribution are available.");
  return input;
}
