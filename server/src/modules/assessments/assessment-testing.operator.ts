import { ConfigService } from "@nestjs/config";
import { AssessmentPocOperator, type PocConfirmation } from "./assessment-poc.operator.js";
import { assessmentHash } from "./assessment.store.js";
import { assessmentMuseAnalysisSchema, businessMuseSelectionSchema, opportunitySelectionSchema } from "../../integrations/assessment-ai/assessment-muse.types.js";
import { buildMockAssessmentMuseOutput } from "../../integrations/assessment-ai/assessment-muse.js";
import { expandBusinessSelection } from "../../integrations/assessment-ai/assessment-muse-business.js";
import { MetaMuseError, type MetaMuseGeneration } from "../../integrations/ai/meta-muse.provider.js";
import { MUSE_TESTING_POLICY, MUSE_TESTING_POLICY_HASH, testingMetadataSchema, type TestingReceipt } from "../../integrations/ai/muse-testing-ledger.js";
import { benchmarkMuseTesting } from "../../integrations/ai/muse-testing-benchmark.js";
import type { AiUsageLimits, AiUsageSummary } from "../../integrations/ai/ai-usage.types.js";

import { AiUsageStore } from "../../integrations/ai/ai-usage.store.js";
import { MetaMuseTransport } from "../../integrations/ai/meta-muse.provider.js";
import { AssessmentAnalysisService } from "./assessment-analysis.service.js";
import { AssessmentStore } from "./assessment.store.js";
import { expandOpportunitySelection } from "../../integrations/assessment-ai/assessment-muse-opportunities.js";
import { prepareV4Comparison, prepareV5Comparison } from "../../integrations/assessment-ai/assessment-v4-evaluation.js";
import { transparencySelectionSchema } from "../../integrations/assessment-ai/assessment-muse.types.js";
import { transparencyBase, validateTransparencySelection } from "../../integrations/assessment-ai/assessment-muse-transparency.js";

/** Local operator only. No activation/generation on startup, preview or saved reads. */
export class AssessmentTestingOperator extends AssessmentPocOperator {
  constructor(config: ConfigService, analyses: AssessmentAnalysisService, store: AssessmentStore, ledger: AiUsageStore, transport: MetaMuseTransport,
    snapshot?: () => Promise<AiUsageSummary>, private readonly selectionVersion: "v3" | "v4" | "v5" = "v3") {
    super(config, analyses, store, ledger, transport, snapshot);
    if (!["v3", "v4", "v5"].includes(selectionVersion)) throw new MetaMuseError("ASSESSMENT_POC_SETTINGS", "Choose an explicit supported selection version.");
  }
  protected override async evidence(businessId: string, assessmentId: string) {
    return this.selectionVersion === "v5" ? this.analyses.prepareV5TestingEvidence(businessId, assessmentId) : this.selectionVersion === "v4" ? this.analyses.prepareV4TestingEvidence(businessId, assessmentId) : this.analyses.preparePocEvidence(businessId, assessmentId);
  }
  protected override runtime(_limits?: AiUsageLimits, live = false) {
    return new ConfigService({ AI_MODEL:"muse-spark-1.3",AI_PROCESSING_MODE:"standard",AI_REASONING_EFFORT:"minimal",AI_MAX_OUTPUT_TOKENS:1500,AI_MAX_INPUT_BYTES:32768,AI_TIMEOUT_MS:60000,
      AI_MODE:"poc",MOCK_AI:false,AI_ENABLED:live,AI_CONTROLLED_TESTING:true,AI_DEV_BUDGET_MICROS:0,AI_DEV_DAILY_MICROS:0,AI_DEV_MAX_CALLS:0,
      ...(live?{MODEL_API_KEY:this.config.get("MODEL_API_KEY")}: {}) });
  }
  async previewTesting(businessId:string,assessmentId:string) {
    const current=await this.prepared(businessId,assessmentId),usage=await this.snapshot();
    const opportunityBundle = current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v5" ? transparencyBase(current.bundle) : current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v4" ? current.bundle : null;
    const testing = usage.testing;
    const wire=JSON.parse(current.wire.payload) as Record<string,unknown>;
    return {stage:"preview",selectionVersion:this.selectionVersion,businessId,assessmentId,sourceManifest:current.bundle.sources,policyVersion:current.bundle.policyVersion,inputHash:current.prepared.inputHash,requestHash:current.wire.requestHash,scope:current.scope,
      wireBytes:Buffer.byteLength(current.wire.payload),maxInputTokens:current.wire.maxInputTokens,priceVersion:current.wire.priceVersion,maximumMicros:current.wire.reserveMicros,analysisCacheKey:current.prepared.cacheKey,
      request:{endpoint:"https://api.meta.ai/v1/responses",model:wire.model,processing:"standard",reasoning:wire.reasoning,max_output_tokens:wire.max_output_tokens,text:wire.text,tools:wire.tools,tool_choice:wire.tool_choice,store:wire.store,stream:wire.stream,background:wire.background,truncation:wire.truncation},
      proposedAllocation:{...MUSE_TESTING_POLICY,policyHash:MUSE_TESTING_POLICY_HASH,initialFundingCeilingMicros:1854992},ledger:usage,
      ...(opportunityBundle ? {
        evaluation: current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v5" ? prepareV5Comparison(current.bundle) : prepareV4Comparison(opportunityBundle),
        testingCapacity: testing ? { fundedRemainingMicros: Math.max(0, testing.allocation.fundedMicros - testing.chargedMicros), callsUsed: testing.calls, callsRemaining: Math.max(0, testing.policy.maxCalls - testing.calls), dailyReservationRemainingMicros: Math.max(0, testing.policy.dailyReservationMicros - testing.dailyReservedMicros), incompleteReceipts: testing.incompleteReceipts } : null,
      } : {}),
      baseline:buildMockAssessmentMuseOutput(current.bundle),allowedSelections:opportunityBundle ? { opportunities: opportunityBundle.opportunities } : {facts:current.bundle.businessContext.facts.map(fact=>({id:fact.id,kind:fact.kind,evidenceRefs:fact.evidenceRefs})),recommendations:current.bundle.businessContext.recommendations.map(item=>({id:item.id,evidenceRefs:item.evidenceRefs}))},
      ...(current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v5" ? { reviewIfOmittedIds: current.bundle.reviewIfOmittedIds } : {}),
      cachedLiveAnalysisId:(this.store.byCacheKey("analysis",businessId,current.prepared.cacheKey) as {id?:string}|null)?.id??null,
      gates:{evidenceValidated:true,requestWithinPerCallCeiling:current.wire.reserveMicros<=500000,testingAllocationActive:!!usage.testing,singleUseApproval:false,allLiveGatesSatisfied:false},noAuthorizationOrReservationCreated:true};
  }
  async activate(businessId:string,assessmentId:string,credential:string,confirmation:PocConfirmation&{policyHash:string}) {
    if (this.selectionVersion !== "v3") throw new MetaMuseError("AI_APPROVAL_REQUIRED", "V4/v5 reuse the existing testing allocation; new activation is not permitted through this path.");
    const actor=this.actor(credential),current=await this.prepared(businessId,assessmentId);this.confirmation(confirmation,current);
    return this.ledger.activateTestingAllocation(actor,confirmation);
  }
  async approveTesting(businessId:string,assessmentId:string,credential:string,confirmation:PocConfirmation&{authorizeOneRequest:boolean;reason:string}) {
    const actor=this.actor(credential),current=await this.prepared(businessId,assessmentId);this.confirmation(confirmation,current);
    if(!confirmation.authorizeOneRequest||!confirmation.reason||confirmation.reason.length>300)throw new MetaMuseError("AI_APPROVAL_REQUIRED","Explicit exact testing approval is required.");
    if(this.store.byCacheKey("analysis",businessId,current.prepared.cacheKey))throw new MetaMuseError("ASSESSMENT_POC_CACHED","Use the saved result without another request.");
    const metadata=testingMetadataSchema.parse({assessmentId,businessId,inputHash:current.prepared.inputHash,sourceManifestHash:assessmentHash(current.bundle.sources),analysisCacheKey:current.prepared.cacheKey,reasoning:"minimal",promptVersion:`assessment-muse-prompt-${this.selectionVersion}`,outputSchemaVersion:this.selectionVersion === "v3" ? "assessment-muse-output-v3" : "assessment-muse-output-v4",
      ...(this.selectionVersion === "v5" ? { selectionSchemaVersion: "assessment-muse-selection-output-v5" } : {})});
    const {payload:_payload,...cost}=current.wire;void _payload;
    const intent=await this.ledger.estimateTesting({...cost,actor,scope:current.scope,cacheKey:current.wire.requestHash,mode:"poc",reason:JSON.stringify(metadata)},metadata);
    const approved=await this.ledger.approve(intent.id,actor);
    return {stage:"approved",intentId:approved.id,requestHash:approved.requestHash,inputHash:metadata.inputHash,maximumMicros:approved.reserveMicros,expiresAt:approved.expiresAt,modelDispatches:0};
  }
  async executeTesting(businessId:string,assessmentId:string,credential:string,intentId:string,confirmation:PocConfirmation&{poc:boolean}) {
    const actor=this.actor(credential);if(!confirmation.poc)throw new MetaMuseError("AI_MOCK_MODE","Deliberate testing execution is required.");
    const intent=await this.ledger.readIntent(intentId),current=await this.prepared(businessId,assessmentId,undefined,true),metadata=testingMetadataSchema.parse(JSON.parse(intent.reason));
    this.confirmation(confirmation,current);
    if(intent.actor!==actor||intent.approvedBy!==actor||!intent.approvedAt||intent.mode!=="poc"||intent.scope!==current.scope||intent.requestHash!==current.wire.requestHash||metadata.inputHash!==current.prepared.inputHash||metadata.sourceManifestHash!==assessmentHash(current.bundle.sources)||metadata.analysisCacheKey!==current.prepared.cacheKey||metadata.promptVersion!==`assessment-muse-prompt-${this.selectionVersion}`||metadata.outputSchemaVersion!==(this.selectionVersion === "v3" ? "assessment-muse-output-v3" : "assessment-muse-output-v4")||metadata.selectionSchemaVersion!==(this.selectionVersion === "v5" ? "assessment-muse-selection-output-v5" : undefined)||metadata.reasoning!=="minimal")throw new MetaMuseError("AI_APPROVAL_MISMATCH","Exact administrator, assessment, evidence and request approval required.");
    const cached=this.store.byCacheKey("analysis",businessId,current.prepared.cacheKey) as {id:string}|null;
    if(cached)return{stage:"review",cacheHit:true,modelDispatches:0,analysis:await this.analyses.read(businessId,assessmentId,cached.id),providerCostMicros:0};
    if(intent.consumedAt||Date.parse(intent.expiresAt)<=Date.now())throw new MetaMuseError("AI_APPROVAL_STALE","Expired or consumed requests cannot retry.");
    const capture:{generation?:MetaMuseGeneration;error?:unknown}={};
    const generate=current.provider.generate.bind(current.provider);
    current.provider.generate=async(...args)=>{try{return capture.generation=await generate(...args);}catch(error){capture.error=error;throw error;}};
    let analysisId:string|null=null,analysis:unknown=null,failureCategory:string|null=null,schemaValid:boolean|null=null,idsValid:boolean|null=null;
    try{
      const result=await current.adapter.analyze(current.bundle,{intentId,actor});
      const record=assessmentMuseAnalysisSchema.parse({...result,authorization:{intentId,actor,requestHash:intent.requestHash,scope:intent.scope,maximumMicros:intent.reserveMicros}});
      const after=await this.prepared(businessId,assessmentId);
      if(after.prepared.inputHash!==current.prepared.inputHash)throw new MetaMuseError("ASSESSMENT_STORAGE_ERROR","Source evidence changed; no analysis was published.");
      current.adapter.validateRecord(current.bundle,record);
      const saved=this.store.write("analysis",{...record,createdAt:record.generatedAt},current.prepared.cacheKey) as {id:string};analysisId=saved.id;
      analysis=await this.analyses.read(businessId,assessmentId,saved.id);
    }catch(error){capture.error=error;const code=(error as {code?:unknown})?.code;failureCategory=typeof code==="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:"ASSESSMENT_TESTING_FAILED";}
    let selectedIds: TestingReceipt["selectedIds"] = null;
    let decisionLabels: TestingReceipt["decisionLabels"];
    if (capture.generation) {
      idsValid = false;
      if (current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v5") {
        const parsed = transparencySelectionSchema.safeParse(capture.generation.output); schemaValid = parsed.success;
        if (parsed.success) try {
          decisionLabels = validateTransparencySelection(parsed.data, current.bundle); idsValid = true;
          selectedIds = { strengths: [], weaknesses: [], recommendations: decisionLabels.selected.map(row => row.id) };
        } catch { /* Invalid labels and IDs are never retained or published. */ }
      } else if (current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v4") {
        const parsed = opportunitySelectionSchema.safeParse(capture.generation.output); schemaValid = parsed.success;
        if (parsed.success) try { expandOpportunitySelection(parsed.data, current.bundle); idsValid = true; selectedIds = { strengths: [], weaknesses: [], recommendations: parsed.data.opportunityIds }; } catch { /* Invalid selections are never retained or published. */ }
      } else {
        const parsed = businessMuseSelectionSchema.safeParse(capture.generation.output); schemaValid = parsed.success;
        if (parsed.success) try { expandBusinessSelection(parsed.data, current.bundle); idsValid = true; selectedIds = { strengths: parsed.data.strengthIds, weaknesses: parsed.data.weaknessIds, recommendations: parsed.data.recommendationIds }; } catch { /* Invalid selections are never retained or published. */ }
      }
    }
    const attempt=await this.ledger.testingAttempt(intentId);if(!attempt)throw capture.error??new MetaMuseError("AI_APPROVAL_REQUIRED","No dispatch occurred.");
    const diagnostics=capture.generation?.diagnostics??(capture.error instanceof MetaMuseError?capture.error.diagnostics:undefined);
    const status=diagnostics?.responseStatus;
    const receipt:TestingReceipt={assessmentId,inputHash:metadata.inputHash,requestHash:intent.requestHash,model:"muse-spark-1.3",reasoning:"minimal",inputTokens:diagnostics?.inputTokens??null,outputTokens:diagnostics?.outputTokens??null,reasoningTokens:diagnostics?.reasoningTokens??null,
      estimatedTokenMicros:diagnostics?.estimatedActualMicros??null,reservedMicros:intent.reserveMicros,ledgerChargeMicros:Number(attempt.charged_micros),attemptId:String(attempt.id),requestId:diagnostics?.requestId??null,httpStatus:diagnostics?.httpStatus??null,
      completionStatus:["completed","incomplete","failed","in_progress","queued","cancelled"].includes(status??"")?status as TestingReceipt["completionStatus"]:null,incompletionReason:diagnostics?.incompletionReason??null,failureCategory,providerError:diagnostics?.providerError??null,
      schemaValid,idsValid,persisted:analysisId!==null,analysisId,cacheHit:false,selectedIds,
      ...(this.selectionVersion === "v4" ? { selectionVersion: "assessment-muse-selection-output-v4" as const } : this.selectionVersion === "v5" ? { selectionVersion: "assessment-muse-selection-output-v5" as const, ...(decisionLabels ? { decisionLabels } : {}) } : {})};
    const storedReceipt=await this.ledger.completeTestingReceipt(actor,intentId,receipt);
    const opportunityBundle = current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v5" ? transparencyBase(current.bundle) : current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v4" ? current.bundle : null;
    return{stage:"review",modelDispatches:1,receipt:storedReceipt,analysis,baseline:buildMockAssessmentMuseOutput(current.bundle),qualityReview:opportunityBundle ? { ...(current.bundle.schemaVersion === "seo-spy.assessment-muse-evidence.v5" ? prepareV5Comparison(current.bundle) : prepareV4Comparison(opportunityBundle)), modelSelection: selectedIds?.recommendations ?? null, modelGeneratesProse: false, modelSelectsZeroToThreeOpportunities: true } : {modelGeneratesProse:false,modelSelectsFactIdsAndOrdersAllPreparedRecommendations:true,requiresHumanReview:["Meaningful strengths and consequential weaknesses","Website, Social and Consistency coverage","Practical priority order and redundancy","Unknown measurements and small-audience limitations","Interpretation beyond verbatim audit excerpts"]},benchmark:benchmarkMuseTesting(await this.ledger.testingReceipts())};
  }
  async benchmark(credential:string){
    this.actor(credential);
    const rows=await this.ledger.testingReceipts(),status=await this.ledger.status(),unfinalizedAttempts=status.testing?.incompleteReceipts??0;
    return {...benchmarkMuseTesting(rows),unfinalizedAttempts,statisticsCoverAllAttempts:unfinalizedAttempts===0,
      ...(unfinalizedAttempts?{reviewRequired:"Unfinalized attempts exist in the ledger. Statistics cover finalized receipts only; no further request or workload projection is permitted."}: {})};
  }
}
