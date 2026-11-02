import { jest } from "@jest/globals";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { readAiUsageSnapshot } from "../src/integrations/ai/ai-usage-snapshot.js";
import { MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { AssessmentPocOperator } from "../src/modules/assessments/assessment-poc.operator.js";
import { AssessmentTestingOperator } from "../src/modules/assessments/assessment-testing.operator.js";
import { MUSE_TESTING_POLICY_HASH } from "../src/integrations/ai/muse-testing-ledger.js";
import { AssessmentAnalysisService } from "../src/modules/assessments/assessment-analysis.service.js";
import { AssessmentStore } from "../src/modules/assessments/assessment.store.js";
import { expandBusinessSelection } from "../src/integrations/assessment-ai/assessment-muse-business.js";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import type { Evidence } from "../src/contracts/domain.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { FacebookReport } from "../src/integrations/facebook/types.js";
import { facebookSocialHistoryEvidence, facebookSocialHistorySchema } from "../src/integrations/facebook/social-history.js";
import { derive90DayPostMeasurements } from "../src/scoring/social-post-measurements.js";
import { SOCIAL_PERFORMANCE_POLICY } from "../src/scoring/social-performance.policy.js";
import { SCORE_POLICY_REGISTRY } from "../src/scoring/policy.js";
import { calculateScoreSnapshot } from "../src/scoring/calculator.js";
import type { ScoreAssessmentInput, ScoreEvidenceRef, ScoreSnapshot } from "../src/scoring/scoring.types.js";
import { MetaMuseProvider, MetaMuseError } from "../src/integrations/ai/meta-muse.provider.js";
import { AssessmentMuseAdapter, prepareAssessmentMuseEvidence, buildMockAssessmentMuseOutput, validateAssessmentMuseOutput } from "../src/integrations/assessment-ai/assessment-muse.js";
import { assessmentMuseAnalysisSchema, businessAssessmentMuseOutputSchema, type AssessmentMuseAnalysis } from "../src/integrations/assessment-ai/assessment-muse.types.js";
import { isCompleteBusinessText } from "../src/integrations/assessment-ai/assessment-muse-text.js";

const at = "2026-11-01T19:50:00.000Z", since = "2026-08-03T00:00:00.000Z", until = "2026-11-01T00:00:00.000Z";
const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const businessId = "business-consultation-fixture";

function fixture() {
  const websiteId = randomUUID(), facebookId = randomUUID();
  const business = { id: businessId, name: "Private fixture name", website: "https://example.com/", createdAt: at };
  const evidence = (auditId: string, id: string, checkId: string, observed: Record<string, string>): Evidence => ({ id, auditId, checkId, observed, mode: "live", collectedAt: at, sourceUrl: "https://example.com/private?token=PRIVATE" });
  const history = facebookSocialHistorySchema.parse({ status: "available", truncated: false, collectedAt: at,
    coverage: { version: "facebook-social-history-v1", kind: "queried-window", since, until, observedAt: at, complete: true, exhausted: true, reason: "complete", pagesRead: 1, maxPages: 10, itemsLimit: 250, ignoredOutOfWindow: 0, duplicateIds: 0, invalidTimestamps: 0 },
    items: ["2026-08-19T20:23:18.000Z", "2026-08-18T12:00:00.000Z", "2026-08-17T12:00:00.000Z"].map((createdTime, index) => ({ id: `123_${index + 1}`, createdTime, message: `Private fixture post ${index}. Contact us with a question.`, messageStatus: "available", url: `https://www.facebook.com/123_${index + 1}` })) });
  const fb: FacebookReport = { provider: "facebook-graph", version: "facebook-v1", graphVersion: "v26.0", pageId: "123", pageName: "Private fixture Page", collectedAt: at,
    window: { since: "2026-10-02T07:00:00.000Z", until: "2026-11-01T07:00:00.000Z", requestedDays: 30, timeZone: "America/Los_Angeles", basis: "complete-provider-days" },
    profile: {}, socialHistory: history, posts: { status: "available", items: history.items, truncated: false, collectedAt: at },
    metrics: ["page_post_likes", "page_media_view"].map((name, index) => ({ name, status: "available", period: "day", points: Array.from({ length: 30 }, (_, day) => ({ endTime: new Date(Date.parse("2026-10-02T07:00:00.000Z") + (day + 1) * 86400000).toISOString(), value: day === 0 ? index === 0 ? 4 : 115 : 0 })), aggregation: "sum", total: index === 0 ? 4 : 115, collectedAt: at,
      sourceMetric: index === 0 ? "page_actions_post_reactions_total" : "page_media_view", ...(index === 0 ? { breakdown: "like" as const } : {}), coverage: { complete: true, expectedDays: 30, returnedDays: 30 } })),
    commentCounts: { basis: "reporting-window", since: "2026-10-02T07:00:00.000Z", until: "2026-11-01T07:00:00.000Z", timeZone: "America/Los_Angeles", status: "available", total: 1, observedTotal: 1, complete: true, postsCollected: 3, postsChecked: 3, collectedAt: at },
    summary: { followersStart: null, followersEnd: null, followersChange: null, latestPostAt: history.items[0].createdTime, postsInWindow: 0, postsInWindowComplete: true },
    coverage: { profileFieldsAvailable: 6, profileFieldsMissing: 0, profileFieldsUnavailable: 0, metricsAvailable: 2, metricsRequested: 2, postsLimit: 50 }, limitations: ["Saved fixture only."] };
  const facebookEvidence: Evidence[] = [evidence(facebookId, "history", "facebook:social-history", facebookSocialHistoryEvidence(history))];
  for (const [name, value] of Object.entries({ name: "Private Page name", about: "Private useful description", website: "https://example.com/", phone: "+17025551212", category: "Business", followers_count: 17, hours: "Always open" })) {
    fb.profile[name] = { status: "available", value, collectedAt: at };
    facebookEvidence.push(evidence(facebookId, `profile-${name}`, `facebook:profile:${name}`, { status: "available", value: JSON.stringify(value) }));
  }
  for (const metric of fb.metrics) facebookEvidence.push(evidence(facebookId, metric.name, `facebook:insight:${metric.name}`, { status: "available", metric: JSON.stringify(metric) }));
  facebookEvidence.push(evidence(facebookId, "comments", "facebook:comment-counts", { status: "available", summary: JSON.stringify(fb.commentCounts) }));
  const report = (auditId: string, facebook: boolean): AuditReportRecord => ({ schemaVersion: "seo-spy.audit-report.v1", reportId: auditId, auditId, generatedAt: at, business,
    audit: { id: auditId, businessId, scope: facebook ? "facebook" : "lighthouse", mode: "live", status: facebook ? "partial" : "completed", stage: "complete", createdAt: at, startedAt: at, completedAt: at, warnings: [], failure: null, scoringVersion: facebook ? "facebook-v1" : "lighthouse-v1" },
    results: { scores: [], evidence: facebook ? facebookEvidence : [evidence(auditId, "website-facts", "business-facts", { name: "Private website name" }), evidence(auditId, "lcp", "lighthouse:largest-contentful-paint", { numericValue: "11600" })],
      findings: facebook ? [] : [{ id: "loading-finding", auditId, checkId: "lighthouse:largest-contentful-paint", title: "Lighthouse: Largest Contentful Paint", explanation: "The saved main content loading measurement is 11.6 seconds.", source: "website", severity: "critical", evidenceIds: ["lcp"], status: "needs_review" }],
      recommendations: facebook ? [] : [{ id: "loading-recommendation", auditId, findingId: "loading-finding", title: "Inspect main content loading", explanation: "Review the saved page.", recommendedChange: "Inspect the main visible resource and its loading timeline. ".repeat(20), purpose: "Diagnose the saved measurement.", status: "needs_review" }],
      ...(facebook ? { facebook: fb } : { lighthouse: { provider: "google-pagespeed-insights", strategy: "mobile", requestedUrl: business.website, finalUrl: business.website, fetchedAt: at, lighthouseVersion: "fixture",
        categories: ["seo", "performance", "accessibility", "best-practices"].map((id, index) => ({ id, title: id, score: [92, 48, 85, 96][index], availability: "measured", auditIds: [] })),
        metrics: [{ id: "largest-contentful-paint", title: "Largest Contentful Paint", value: 11600, unit: "ms", displayValue: "11.6 s" }], checks: [], warnings: [] } }),
    } } as AuditReportRecord);
  const reports = [report(websiteId, false), report(facebookId, true)];
  const ref = (evidenceId: string): ScoreEvidenceRef => ({ reportId: facebookId, evidenceId });
  const criterionRefs = (id: string): ScoreEvidenceRef[] => {
    if (id === "likes-per-100-followers") return [ref("page_post_likes"), ref("profile-followers_count")];
    if (id === "comments-per-100-followers") return [ref("comments"), ref("profile-followers_count")];
    if (id === "media-views-per-follower") return [ref("page_media_view"), ref("profile-followers_count")];
    const profile: Record<string, string> = { "profile-name": "name", "profile-description": "about", "profile-website": "website", "profile-contact": "phone", "profile-category": "category" };
    return id.startsWith("profile-") ? [ref(`profile-${profile[id]}`)] : [ref("history")];
  };
  const input: ScoreAssessmentInput = { policyVersion: "seo-spy-score-v1.4", businessId, cutoff: at, profile: "baseline-mobile-v1", expectedAssets: { websiteUrl: business.website, facebookPageId: "123" },
    sources: reports.map((item, index) => ({ reportId: item.reportId, reportHash: hash(item), businessId, schemaVersion: item.schemaVersion, provider: index === 0 ? "website" : "facebook", mode: "live", asset: index === 0 ? business.website : "123", collectedAt: at, selectionReason: "Explicit saved fixture selection", evidenceIds: [...item.results!.evidence.map(entry => entry.id), ...(item.results!.lighthouse?.categories.map(entry => `lighthouse-category:${entry.id}`) ?? [])] })),
    website: { sourceReportId: websiteId, auditId: websiteId, requestedUrl: business.website, finalUrl: business.website, strategy: "mobile", lighthouseVersion: "fixture", fetchedAt: at, categories: reports[0].results!.lighthouse!.categories },
    social: { sourceReportId: facebookId, profile: [], goal: null, publishing: null, performance: { businessId, pageId: "123", reportId: facebookId, collectedAt: at, cutoff: at, evidenceIds: facebookEvidence.map(item => item.id), criteria: {} } },
    consistency: { websiteReportId: websiteId, facebookReportId: facebookId, comparisonMode: "preferred-values", facts: { revision: "confirmed-fixture-facts", confirmedBy: "fixture-operator", confirmedAt: at }, applicability: null,
      criteria: ["business-name", "phone", "website-url", "hours"].map(id => ({ id, outcome: ["phone", "website-url"].includes(id) ? "pass" : "fail", confirmation: "observed", applicable: true,
        evidence: [{ reportId: websiteId, evidenceId: "website-facts" }, ref(`profile-${id === "business-name" ? "name" : id === "website-url" ? "website" : id}`)] })) },
  };
  const values: Record<string, number> = { ...derive90DayPostMeasurements(history.items, since, until, true), "likes-per-100-followers": 4 * 100 / 17, "comments-per-100-followers": 100 / 17, "media-views-per-follower": 115 / 17, "actionable-post-ratio": 1, "observable-structure-count": 3, "distinct-post-ratio": 1 };
  for (const group of SOCIAL_PERFORMANCE_POLICY.categories) for (const definition of group.criteria) {
    if (["shares-per-100-followers", "follower-growth-percent", "reviewed-relevance", "customer-response-rate", "customer-response-hours"].includes(definition.id)) continue;
    const value = definition.id.startsWith("profile-") ? definition.id === "profile-description" ? 2 : 1 : values[definition.id];
    input.social!.performance!.criteria[definition.id] = { status: "available", value, evidence: criterionRefs(definition.id), collectedAt: at, complete: true, explanation: "Trusted fixture measurement, not a provider call." };
  }
  const assessmentId = randomUUID(), snapshot = calculateScoreSnapshot(input);
  const bundleFor = (snapshot: ScoreSnapshot, version: "v1" | "v2" | "v3" = "v3") => prepareAssessmentMuseEvidence({ assessmentId, businessId, policyVersion: snapshot.policyVersion, cutoff: at,
    sources: reports, scores: Object.entries(snapshot.scores).map(([category, score]) => ({ category: category as "website" | "social" | "consistency" | "overall", value: score.value, reasonCodes: score.reasons })),
    ...(version === "v1" ? {} : { snapshot, version }) });
  return { reports, fb, snapshot, input, bundleFor };
}

describe("isolated single assessment POC operator (offline transport only)", () => {
  const admin = "offline-admin-credential-".repeat(3);
  let directory: string, config: ConfigService, database: AppDatabase, ledger: AiUsageStore, store: AssessmentStore;
  let operator: AssessmentPocOperator, service: AssessmentAnalysisService, send: ReturnType<typeof jest.fn<MetaMuseTransport["post"]>>;
  let bundle: ReturnType<ReturnType<typeof fixture>["bundleFor"]>;
  let targetBusiness: string, targetAssessment: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-poc-test-"));
    config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AI_USAGE_DB: join(directory, "usage.sqlite"), AI_ADMIN_KEY: admin,
      MODEL_API_KEY: "offline-fake-key-never-dispatched", AI_DEV_BUDGET_MICROS: 0, MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, AI_TIMEOUT_MS: 1000 });
    database = new AppDatabase(config); store = new AssessmentStore(database); ledger = new AiUsageStore(config); await ledger.status();
    const data = fixture(); bundle = data.bundleFor(data.snapshot);
    targetBusiness = bundle.businessId; targetAssessment = bundle.assessmentId;
    database.connection().prepare("INSERT INTO businesses(id,created_at,data_json) VALUES(?,?,?)").run(targetBusiness, at, JSON.stringify(data.reports[0].business));
    service = {
      preparePocEvidence: jest.fn<AssessmentAnalysisService["preparePocEvidence"]>().mockImplementation(async (businessId, assessmentId) => {
        if (businessId !== targetBusiness || assessmentId !== targetAssessment || bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Wrong bound business or assessment");
        return bundle;
      }),
      read: jest.fn<AssessmentAnalysisService["read"]>().mockImplementation(async (businessId, assessmentId, id) => {
        const stored = store.read("analysis", businessId, id) as Record<string, unknown>;
        const { createdAt: _createdAt, ...record } = stored; void _createdAt;
        const parsed = assessmentMuseAnalysisSchema.parse(record);
        if (parsed.assessmentId !== assessmentId) throw new Error("Wrong assessment");
        validateAssessmentMuseOutput(parsed.output, bundle);
        return parsed;
      }),
    } as unknown as AssessmentAnalysisService;
    send = jest.fn<MetaMuseTransport["post"]>().mockImplementation(async payload => {
      const wire = JSON.parse(payload) as { input: { content: { text: string }[] }[] };
      const evidence = JSON.parse(wire.input[0].content[0].text) as Extract<typeof bundle, { schemaVersion: "seo-spy.assessment-muse-evidence.v3" }>;
      const selection = { schemaVersion: "assessment-muse-selection-output-v3", strengthIds: evidence.businessContext.facts.filter(item => item.kind === "strength").slice(0, 3).map(item => item.id), weaknessIds: evidence.businessContext.facts.filter(item => item.kind === "weakness").slice(0, 3).map(item => item.id), recommendationIds: evidence.businessContext.recommendations.map(item => item.id) };
      return { status: 200, requestId: "offline-request", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 5000, output_tokens: 120 }, output: [{ type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(selection) }] }] }) };
    });
    operator = new AssessmentPocOperator(config, service, store, ledger, { post: send } as unknown as MetaMuseTransport);
  });
  afterEach(async () => {
    jest.restoreAllMocks(); database.close(); ledger.onModuleDestroy();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true });
  });
  const confirmation = (preview: Awaited<ReturnType<AssessmentPocOperator["preview"]>>) => ({ confirmed: true, requestHash: preview.requestHash, inputHash: preview.inputHash, maximumMicros: preview.maximumMicros });
  const approve = async () => {
    const preview = await operator.preview(targetBusiness, targetAssessment);
    const confirmed = confirmation(preview);
    const approved = await operator.approve(targetBusiness, targetAssessment, admin, { ...confirmed, authorizeOneRequest: true, reason: "Offline exact selection compatibility fixture" });
    return { preview, confirmed, approved };
  };
  const testingOperator=async()=>{
    let now=Date.parse("2026-11-01T23:00:00.000Z");jest.spyOn(Date,"now").mockImplementation(()=>now);
    for(let index=0;index<4;index++){
      const reserve=index===0?131460:index===3?8196:6544;
      const intent=await ledger.estimate({actor:"offline-history",scope:`history:${index}`,requestHash:hash(index),cacheKey:hash(index),mode:"poc",model:"muse-spark-1.3",maxInputTokens:index===0?100068:index===3?4816:4800,maxOutputTokens:index===0?1500:index===3?512:128,reserveMicros:reserve,priceVersion:"offline-test",reason:"Immutable prior attempt fixture"});
      await ledger.approve(intent.id,"offline-history");const attempt=await ledger.reserve(intent.id,{actor:intent.actor,requestHash:intent.requestHash,mode:"poc"});
      await ledger.settle(attempt.id,index===3?{status:"success",inputTokens:10,outputTokens:105,actualMicros:460}:{status:"failed",errorCode:"AI_PROVIDER_FAILED"});now+=61000;
    }
    await expect(ledger.estimate({actor:"offline-history",scope:"unused",requestHash:hash("unused"),cacheKey:hash("unused"),mode:"poc",model:"muse-spark-1.3",maxInputTokens:4800,maxOutputTokens:128,reserveMicros:6544,priceVersion:"offline-test",reason:"Reduce permanent development limits"},{budgetMicros:152744,dailyMicros:152744,maxCalls:4})).rejects.toBeDefined();
    return new AssessmentTestingOperator(config,service,store,ledger,{post:send} as unknown as MetaMuseTransport,()=>ledger.status());
  };
  it.each(["success","schema","ids","incomplete","http","network","persistence"])("runs controlled testing %s through the real v3 pipeline with offline transport",async kind=>{
    const testing=await testingOperator(),before=await ledger.status(),preview=await testing.previewTesting(targetBusiness,targetAssessment);
    const confirmed={confirmed:true,requestHash:preview.requestHash,inputHash:preview.inputHash,maximumMicros:preview.maximumMicros};
    expect(preview.request).toMatchObject({reasoning:{effort:"minimal"},max_output_tokens:1500,tools:[],tool_choice:"auto",text:{format:{strict:true}}});
    expect(send).not.toHaveBeenCalled();expect(await ledger.status()).toEqual(before);
    await expect(testing.approveTesting(targetBusiness,targetAssessment,admin,{...confirmed,authorizeOneRequest:true,reason:"Offline single report test"})).rejects.toBeDefined();
    await testing.activate(targetBusiness,targetAssessment,admin,{...confirmed,policyHash:MUSE_TESTING_POLICY_HASH});
    const approval=await testing.approveTesting(targetBusiness,targetAssessment,admin,{...confirmed,authorizeOneRequest:true,reason:"Offline single report test"});
    const original=send.getMockImplementation()!;
    send.mockImplementation(async(...args)=>{
      if(kind==="network")throw new MetaMuseError("AI_NETWORK_ERROR","Offline network failure");
      if(kind==="http")return{status:400,requestId:"offline-http",body:"",providerError:{code:"invalid_schema",type:"invalid_request_error",message:"Sanitized fixture rejection"}};
      const response=await original(...args),body=JSON.parse(response.body);
      body.usage.output_tokens_details={reasoning_tokens:80};
      if(kind==="incomplete"){body.status="incomplete";body.incomplete_details={reason:"max_output_tokens"};body.output=[{type:"reasoning"}];}
      if(kind==="schema")body.output[0].content[0].text=JSON.stringify({wrong:"schema"});
      if(kind==="ids"){const selected=JSON.parse(body.output[0].content[0].text);selected.strengthIds=["invented-id"];body.output[0].content[0].text=JSON.stringify(selected);}
      return{...response,body:JSON.stringify(body)};
    });
    if(kind==="persistence")jest.spyOn(store,"write").mockImplementation(()=>{throw new Error("Offline storage failure");});
    const result=await testing.executeTesting(targetBusiness,targetAssessment,admin,approval.intentId,{...confirmed,poc:true});
    expect("receipt" in result).toBe(true);if(!("receipt" in result)||!result.receipt)throw new Error("Missing attempt receipt");
    expect(result.receipt).toMatchObject({assessmentId:targetAssessment,inputHash:preview.inputHash,requestHash:preview.requestHash,model:"muse-spark-1.3",reasoning:"minimal",cacheHit:false,persisted:kind==="success"});
    expect(send).toHaveBeenCalledTimes(1);expect((await ledger.status()).development).toEqual(before.development);expect((await ledger.status()).demo).toEqual(before.demo);
    expect((await ledger.status()).recentAttempts.slice(1)).toEqual(before.recentAttempts);
    expect(await ledger.testingReceipts()).toEqual([result.receipt]);
    if(kind==="success"){
      expect(result.receipt).toMatchObject({schemaValid:true,idsValid:true,reasoningTokens:80,inputTokens:5000,outputTokens:120,ledgerChargeMicros:6760,estimatedTokenMicros:6760,completionStatus:"completed"});
      const again=await testing.executeTesting(targetBusiness,targetAssessment,admin,approval.intentId,{...confirmed,poc:true});expect(again).toMatchObject({cacheHit:true,modelDispatches:0,providerCostMicros:0});
      expect(await testing.benchmark(admin)).toMatchObject({sampleStatus:"insufficient-for-workload-extrapolation",counts:{attempts:1,successfulAssessments:1}});
    }else{
      expect(result.receipt.failureCategory).not.toBeNull();
      if(kind==="schema")expect(result.receipt).toMatchObject({schemaValid:false,idsValid:false});
      if(kind==="ids")expect(result.receipt).toMatchObject({schemaValid:true,idsValid:false,selectedIds:null});
      if(kind==="incomplete")expect(result.receipt).toMatchObject({completionStatus:"incomplete",incompletionReason:"max_output_tokens",reasoningTokens:80,failureCategory:"AI_TRUNCATED"});
      if(kind==="http")expect(result.receipt).toMatchObject({httpStatus:400,providerError:{code:"invalid_schema"}});
      await expect(testing.executeTesting(targetBusiness,targetAssessment,admin,approval.intentId,{...confirmed,poc:true})).rejects.toBeDefined();
    }
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("previews exact settings and evidence without touching original ledger bytes or approving anything", async () => {
    const path = join(directory, "usage.sqlite"), before = await readFile(path), beforeInput = hash(bundle);
    const preview = await operator.preview(targetBusiness, targetAssessment);
    expect(preview.currentEffectivePocBudgetMicros).toBe(0); expect(preview.remainingEffectivePocBudgetMicros).toBe(0);
    expect(preview.gates.allLiveGatesSatisfied).toBe(false); expect(preview.gates.evidenceValidated).toBe(true);
    expect(preview.request).toMatchObject({ model: "muse-spark-1.3", reasoning: { effort: "low" }, max_output_tokens: 1500, tools: [], tool_choice: "auto", stream: false, background: false, store: false, truncation: "disabled" });
    expect(preview.ledger.development).toMatchObject({ calls: 0, chargedMicros: 0, budgetMicros: 2000000 });
    expect(await readFile(path)).toEqual(before); expect(hash(bundle)).toBe(beforeInput); expect(send).not.toHaveBeenCalled();
    expect((await readAiUsageSnapshot(config)).recentAttempts).toEqual([]);
  });
  it.each(["credential", "request", "input", "cost", "confirmed", "allowance", "business", "assessment"])("blocks invalid authorization before dispatch: %s", async kind => {
    const preview = await operator.preview(targetBusiness, targetAssessment), body = { ...confirmation(preview), authorizeOneRequest: true, reason: "Offline fixture necessity reason" };
    if (kind === "request") body.requestHash = "0".repeat(64);
    if (kind === "input") body.inputHash = "0".repeat(64);
    if (kind === "cost") body.maximumMicros--;
    if (kind === "confirmed") body.confirmed = false;
    if (kind === "allowance") body.authorizeOneRequest = false;
    await expect(operator.approve(kind === "business" ? "wrong" : targetBusiness, kind === "assessment" ? randomUUID() : targetAssessment, kind === "credential" ? "incorrect" : admin, body)).rejects.toBeDefined();
    expect(send).not.toHaveBeenCalled(); expect((await ledger.status()).development.calls).toBe(0);
  });
  it("consumes one exact approval, saves provenance and uses immutable cache on duplicates and reads", async () => {
    const before = hash(bundle), { preview, confirmed, approved } = await approve();
    expect(send).not.toHaveBeenCalled();
    expect(approved.limits).toEqual({ budgetMicros: preview.maximumMicros, dailyMicros: preview.maximumMicros, maxCalls: 1 });
    const result = await operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true });
    expect(result.analysis).toMatchObject({ provider: "meta", generationMode: "poc", isMock: false, usage: { inputTokens: 5000, outputTokens: 120 }, requestId: "offline-request", authorization: { intentId: approved.intentId, requestHash: preview.requestHash } });
    expect(result.analysis.output.limitations[0]).toContain("rendered the assessment prose and citations locally");
    expect((await operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true })).modelDispatches).toBe(0);
    expect((await operator.review(targetBusiness, targetAssessment, admin, result.analysis.id)).analysis).toEqual(result.analysis);
    expect(send).toHaveBeenCalledTimes(1); expect(hash(bundle)).toBe(before);
    expect(config.get("AI_DEV_BUDGET_MICROS")).toBe(0); expect(config.get("MOCK_AI")).toBe(true);
    expect((await ledger.status()).development.calls).toBe(1);
    await expect(approve()).rejects.toBeDefined();
  });
  it("serializes parallel attempts using the existing transactional single-use reservation", async () => {
    const { approved, confirmed } = await approve();
    const results = await Promise.allSettled([1, 2].map(() => operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true })));
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1); expect((await ledger.status()).development.calls).toBe(1);
  });
  it.each(["changed-input", "expired", "no-poc", "other-admin"])("rejects changed/expired execution authorization: %s", async kind => {
    const { approved, confirmed } = await approve();
    if (kind === "changed-input" && bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v3") bundle.businessContext.executiveAssessment += " Review the saved cutoff.";
    if (kind === "expired") jest.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60000);
    const credential = kind === "other-admin" ? "different" : admin;
    await expect(operator.execute(targetBusiness, targetAssessment, credential, approved.intentId, { ...confirmed, poc: kind !== "no-poc" })).rejects.toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });
  it("cannot raise an already ratcheted zero policy or change the model configuration", async () => {
    const { confirmed, approved } = await approve();
    const intent = await ledger.readIntent(approved.intentId);
    await expect(ledger.reserve(approved.intentId, { actor: intent.actor, requestHash: intent.requestHash, mode: "poc" }, { budgetMicros: 0, dailyMicros: 0, maxCalls: 0 })).rejects.toBeDefined();
    await expect(operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true })).rejects.toBeDefined();
    expect(send).not.toHaveBeenCalled(); expect((await ledger.status()).development.budgetMicros).toBe(0);
    const changed = new ConfigService({ AI_MODEL: "muse-spark-1.2" });
    await expect(new AssessmentPocOperator(changed, service, store, ledger, { post: send } as unknown as MetaMuseTransport).preview(targetBusiness, targetAssessment)).rejects.toBeDefined();
  });
  it("rejects another authenticated administrator and an approval for another scope", async () => {
    const { approved, confirmed } = await approve(), intent = await ledger.readIntent(approved.intentId);
    const otherAdmin = "another-offline-administrator-".repeat(3);
    const other = new AssessmentPocOperator(new ConfigService({ AI_ADMIN_KEY: otherAdmin }), service, store, ledger, { post: send } as unknown as MetaMuseTransport);
    await expect(other.execute(targetBusiness, targetAssessment, otherAdmin, intent.id, { ...confirmed, poc: true })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    const foreign = await ledger.estimate({ actor: intent.actor, scope: "assessment:another-business:another-assessment", requestHash: intent.requestHash, cacheKey: intent.cacheKey,
      mode: "poc", model: intent.model, maxInputTokens: intent.maxInputTokens, maxOutputTokens: intent.maxOutputTokens, reserveMicros: intent.reserveMicros, priceVersion: intent.priceVersion, reason: intent.reason });
    await ledger.approve(foreign.id, intent.actor);
    await expect(operator.execute(targetBusiness, targetAssessment, admin, foreign.id, { ...confirmed, poc: true })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    expect(send).not.toHaveBeenCalled();
  });
  it("retains the consumed attempt when publishing the validated output fails", async () => {
    const { approved, confirmed } = await approve();
    jest.spyOn(store, "write").mockImplementationOnce(() => { throw new Error("Offline publication failure"); });
    await expect(operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true })).rejects.toBeDefined();
    await expect(operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true })).rejects.toBeDefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await ledger.status()).development.calls).toBe(1);
    expect((await ledger.status()).development.chargedMicros).toBeGreaterThan(0);
  });
  it.each(["invented", "duplicate", "missing", "malformed", "rejected", "timeout"])("never saves or retries a failed model result: %s", async kind => {
    const { approved, confirmed, preview } = await approve();
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (...args) => {
      if (kind === "timeout") return new Promise(() => undefined);
      if (kind === "rejected") return { status: 429, body: "", requestId: "offline-rejected" };
      if (kind === "malformed") return { status: 200, body: "not JSON", requestId: null };
      const response = await original(...args), body = JSON.parse(response.body) as { output: { content: { text: string }[] }[] };
      const selected = JSON.parse(body.output[0].content[0].text) as { strengthIds: string[]; recommendationIds: string[] };
      if (kind === "invented") selected.strengthIds = ["invented"];
      if (kind === "duplicate") selected.strengthIds = [selected.strengthIds[0], selected.strengthIds[0]];
      if (kind === "missing") selected.recommendationIds = [];
      body.output[0].content[0].text = JSON.stringify(selected); return { ...response, body: JSON.stringify(body) };
    });
    await expect(operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true })).rejects.toBeDefined();
    await expect(operator.execute(targetBusiness, targetAssessment, admin, approved.intentId, { ...confirmed, poc: true })).rejects.toBeDefined();
    expect(send).toHaveBeenCalledTimes(1); expect(store.list("analysis", targetBusiness)).toEqual([]);
    const status = await ledger.status(); expect(status.development.calls).toBe(1);
    if (["timeout", "malformed", "rejected"].includes(kind)) expect(status.development.chargedMicros).toBe(preview.maximumMicros);
    if (["timeout", "malformed"].includes(kind)) expect(status.halted).toBe(true);
  });
});

describe("v3 evidence-backed business consultation", () => {
  it("includes verified posting counts/windows, audience denominator and absolute actions alongside ratios", () => {
    const { snapshot, bundleFor } = fixture();
    expect(Object.values(snapshot.scores).map(item => item.value)).toEqual([80, 71, 60, 73]);
    const bundle = bundleFor(snapshot);
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Expected v3");
    const measure = (id: string) => bundle.businessContext.measures.find(item => item.id === id)!;
    expect(measure("posts")).toMatchObject({ value: 3, since, until });
    expect(measure("posting-recency-days").value).toBeCloseTo(73.15, 2);
    expect(measure("followers").value).toBe(17);
    expect(measure("likes-per-100-followers")).toMatchObject({ value: 4, normalizedValue: 4 * 100 / 17 });
    expect(measure("comments-per-100-followers")).toMatchObject({ value: 1, normalizedValue: 100 / 17 });
    expect(measure("media-views-per-follower")).toMatchObject({ value: 115, normalizedValue: 115 / 17 });
    expect(measure("largest-contentful-paint").value).toBe(11.6);
    expect(bundle.scoringContext.socialCoveragePercent).toBe(71);
    expect(bundle.businessContext.overallContributions.map(row => row.weight)).toEqual([50, 30, 20]);
    expect(JSON.stringify(bundle)).not.toMatch(/Private fixture|PRIVATE|17025551212|private\?token/);
  });
  it("uses diverse business facts and complete, non-redundant priorities instead of repeated technical symptoms", () => {
    const { snapshot, bundleFor } = fixture(), bundle = bundleFor(snapshot);
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Expected v3");
    expect(bundle.businessContext.facts.map(item => item.group)).toEqual(expect.arrayContaining(["loading", "posting", "consistency", "profile", "audience"]));
    const output = businessAssessmentMuseOutputSchema.parse(buildMockAssessmentMuseOutput(bundle));
    expect(output.summary).toMatch(/11\.6 seconds/); expect(output.summary).toMatch(/3 posts over 90 days/); expect(output.summary).toMatch(/73 days/); expect(output.summary).toMatch(/17 followers/);
    expect(output.scoringExplanation.text).toMatch(/Social 71\/100/); expect(output.scoringExplanation.text).toMatch(/Coverage is 71%/);
    expect(output.scoringExplanation.text).toMatch(/posting 0\/20/); expect(output.scoringExplanation.text).toMatch(/4 likes and 1 comment\/reply/);
    expect(output.scoringExplanation.text).toMatch(/volatile/); expect(output.scoringExplanation.text).toMatch(/Consistency 60\/100/);
    expect(output.scoringExplanation.text).toMatch(/business name and hours/); expect(output.scoringExplanation.text).toMatch(/neither source is presumed correct/);
    expect(output.recommendations.map(item => item.origin.category)).toEqual(["website", "social", "consistency"]);
    expect(output.recommendations[1]).toMatchObject({ findingId: "score:social:posting", origin: { kind: "scoring-observation" } });
    expect(output.recommendations[2]).toMatchObject({ findingId: "score:consistency:disagreements", origin: { kind: "scoring-observation" } });
    expect(output.measurementGaps).toHaveLength(5);
    for (const recommendation of output.recommendations) {
      expect(isCompleteBusinessText(recommendation.recommendation)).toBe(true);
      expect(isCompleteBusinessText(recommendation.rationale)).toBe(true);
      expect(recommendation.verificationSteps.every(isCompleteBusinessText)).toBe(true);
      expect(recommendation.effort).toBe("unknown"); expect(recommendation.risk).toBe("unknown");
    }
    expect(validateAssessmentMuseOutput(output, bundle)).toEqual(output);
  });
  it.each(["summary", "scoring", "target", "origin", "citation", "claim", "gap"])("rejects changed verified numerical narrative, targets or provenance: %s", kind => {
    const { snapshot, bundleFor } = fixture(), bundle = bundleFor(snapshot);
    const output = businessAssessmentMuseOutputSchema.parse(buildMockAssessmentMuseOutput(bundle));
    if (kind === "summary") output.summary = output.summary.replace("17 followers", "1700 followers");
    if (kind === "scoring") output.scoringExplanation.text = output.scoringExplanation.text.replace("Social 71", "Social 100");
    if (kind === "target") output.recommendations[0].findingId = "invented-target";
    if (kind === "origin") output.recommendations[1].origin.kind = "finding";
    if (kind === "citation") output.recommendations[0].evidenceRefs[0].reportId = randomUUID();
    if (kind === "claim") output.strengths[0].text = "Customers now prefer this business.";
    if (kind === "gap") output.measurementGaps[0].explanation = "Missing shares prove the Page performs poorly.";
    expect(() => validateAssessmentMuseOutput(output, bundle)).toThrow();
  });
  it("does not substitute zero for unavailable count/denominator companions or broken history proof", () => {
    const { reports, fb, input, bundleFor } = fixture();
    fb.profile.followers_count.status = "unavailable"; fb.profile.followers_count.value = null;
    reports[1].results!.evidence.find(item => item.checkId === "facebook:social-history")!.observed.itemsHash = "invalid";
    input.sources[1].reportHash = hash(reports[1]);
    const snapshot = calculateScoreSnapshot(input), bundle = bundleFor(snapshot);
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Expected v3");
    expect(bundle.businessContext.measures.some(item => ["followers", "posts", "posting-recency-days", "likes-per-100-followers", "comments-per-100-followers"].includes(item.id))).toBe(false);
    expect(bundle.businessContext.executiveAssessment).toMatch(/not fully established/);
    expect(bundle.businessContext.executiveAssessment).toMatch(/Audience size is not verified/);
    expect(bundle.businessContext.recommendations.some(item => item.findingId === "score:social:posting")).toBe(false);
  });
  it("corrects singular prose without changing evidence or rejecting historical v3 text", () => {
    const { snapshot, bundleFor } = fixture(), bundle = bundleFor(snapshot);
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Expected v3");
    const before = hash(bundle), output = businessAssessmentMuseOutputSchema.parse(buildMockAssessmentMuseOutput(bundle));
    expect(JSON.stringify(output)).not.toContain("1 comments/replies");
    expect(JSON.stringify(output)).toContain("4 likes");
    const historical = structuredClone(output);
    historical.scoringExplanation.text = bundle.businessContext.scoringExplanation;
    for (const claim of [...historical.strengths, ...historical.weaknesses]) claim.text = bundle.businessContext.facts.find(item => item.id === claim.observationId)!.text;
    expect(validateAssessmentMuseOutput(historical, bundle)).toEqual(historical);
    expect(hash(bundle)).toBe(before);
  });
  it("materializes a supplied provider selection with truthful provenance and no extra generation", () => {
    const { snapshot, bundleFor } = fixture(), bundle = bundleFor(snapshot);
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Expected v3");
    const selection = { schemaVersion: "assessment-muse-selection-output-v3", strengthIds: bundle.businessContext.facts.filter(item => item.kind === "strength").slice(0, 3).map(item => item.id), weaknessIds: bundle.businessContext.facts.filter(item => item.kind === "weakness").slice(0, 3).map(item => item.id), recommendationIds: bundle.businessContext.recommendations.map(item => item.id) };
    const output = expandBusinessSelection(selection, bundle);
    expect(output.limitations[0]).toContain("rendered the assessment prose and citations locally");
    expect(JSON.stringify(output)).not.toContain("MOCK AI OUTPUT");
    expect(validateAssessmentMuseOutput(output, bundle)).toEqual(output);
    expect(() => expandBusinessSelection({ ...selection, recommendationIds: ["invented"] }, bundle)).toThrow();
  });
  it("keeps v1/v2/v3 records, schemas and caches isolated without recalculating historical policies", async () => {
    const { input, snapshot, reports, bundleFor } = fixture();
    const before = hash({ snapshot, reports, policies: SCORE_POLICY_REGISTRY });
    const generate = jest.fn<MetaMuseProvider["generate"]>(), estimate = jest.fn<MetaMuseProvider["estimate"]>();
    const adapter = new AssessmentMuseAdapter(new ConfigService({ MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false }), { generate, estimate } as unknown as MetaMuseProvider);
    const versions = ["v1", "v2", "v3"] as const;
    const records: AssessmentMuseAnalysis[] = [];
    for (const version of versions) {
      const bundle = bundleFor(snapshot, version), analysis = await adapter.analyze(bundle);
      expect(adapter.validateRecord(bundle, analysis)).toEqual(analysis);
      expect(assessmentMuseAnalysisSchema.parse(analysis)).toEqual(analysis);
      records.push(analysis);
    }
    expect(new Set(records.map(item => item.cacheKey)).size).toBe(3);
    expect(new Set(records.map(item => item.promptVersion)).size).toBe(3);
    expect(() => adapter.validateRecord(bundleFor(snapshot, "v3"), records[1])).toThrow();
    expect(assessmentMuseAnalysisSchema.safeParse({ ...records[2], fixtureVersion: records[1].fixtureVersion }).success).toBe(false);
    expect(hash(calculateScoreSnapshot(input))).toBe(hash(snapshot));
    expect(hash({ snapshot, reports, policies: SCORE_POLICY_REGISTRY })).toBe(before);
    expect(generate).not.toHaveBeenCalled(); expect(estimate).not.toHaveBeenCalled();
    expect(Buffer.byteLength(JSON.stringify(adapter.prepare(bundleFor(snapshot)).modelInput))).toBeLessThan(32768);
  });
});
