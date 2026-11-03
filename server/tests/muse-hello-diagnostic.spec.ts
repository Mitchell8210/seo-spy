import { withHistoricalAiPolicy } from "./fixtures/historical-ai-policy.js";
import "reflect-metadata";
import {jest} from "@jest/globals";
import {ConfigService} from "@nestjs/config";
import {mkdtemp,rm} from "node:fs/promises";
import {join,resolve,sep} from "node:path";
import {tmpdir} from "node:os";
import {PassThrough} from "node:stream";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import type {IncomingMessage} from "node:http";
import {AiUsageStore} from "../src/integrations/ai/ai-usage.store.js";
import {MetaMuseProvider,MetaMuseTransport,MetaMuseError,readMetaMuseResponse} from "../src/integrations/ai/meta-muse.provider.js";
import {prepareMuseHello,prepareMinimalMuseHello,MUSE_HELLO_PAYLOAD,MUSE_HELLO_V1_HASH,MUSE_HELLO_V1_SCOPE} from "../src/integrations/ai/muse-hello-request.js";

describe("historical Hello receipt compatibility and protected diagnostics (offline)",()=>{
  let directory:string,ledger:AiUsageStore,now:number,oldId:string,oldIntentId:string;
  const actor="a".repeat(64),key="private-offline-model-credential-never-sent";
  let send:ReturnType<typeof jest.fn<MetaMuseTransport["post"]>>;
  beforeEach(async()=>{
    directory=await mkdtemp(join(tmpdir(),"seo-spy-hello-test-"));
    now=Date.parse("2026-11-01T23:00:00.000Z");jest.spyOn(Date,"now").mockImplementation(()=>now);
    ledger=new AiUsageStore(new ConfigService({AI_USAGE_DB:join(directory,"usage.sqlite")}));
    const original=await ledger.estimate({actor:"old-operator",scope:"assessment:fixture:original",requestHash:"d4c2fdb6694981d374ed304dd1ecbc477e85d0ed2709cb9c5cf2ea48ddf0aa39",cacheKey:"b".repeat(64),mode:"poc",model:"muse-spark-1.3",maxInputTokens:100068,maxOutputTokens:1500,reserveMicros:131460,priceVersion:"meta-spark-standard-2026-10-31",reason:"Original failed assessment fixture, permanently retained."},{budgetMicros:131460,dailyMicros:131460,maxCalls:1});
    await ledger.approve(original.id,"old-administrator");
    const attempt=await ledger.reserve(original.id,{actor:original.actor,requestHash:original.requestHash,mode:"poc"});oldId=attempt.id;oldIntentId=original.id;
    await ledger.settle(oldId,{status:"failed",errorCode:"AI_PROVIDER_FAILED",requestId:"old-request"});now+=61000;
    send=jest.fn<MetaMuseTransport["post"]>().mockResolvedValue({status:200,requestId:"hello-request",body:JSON.stringify({status:"completed",model:"muse-spark-1.3",usage:{input_tokens:3,output_tokens:20},output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"Hello!"}]}]})});
  });
  afterEach(async()=>{ledger.onModuleDestroy();jest.restoreAllMocks();expect(resolve(directory).startsWith(resolve(tmpdir())+sep)).toBe(true);await rm(directory,{recursive:true});});
  // Historical audit construction only; current dispatch always sees the shared $25 policy.
  const amendHello = (...args: Parameters<AiUsageStore["amendHelloDiagnostic"]>) => withHistoricalAiPolicy(join(directory,"usage.sqlite"), {budgetMicros:131460,dailyMicros:131460,maxCalls:1}, () => ledger.amendHelloDiagnostic(...args));
  const amendCorrected = (...args: Parameters<AiUsageStore["amendCorrectedHelloDiagnostic"]>) => withHistoricalAiPolicy(join(directory,"usage.sqlite"), {budgetMicros:138004,dailyMicros:138004,maxCalls:2}, () => ledger.amendCorrectedHelloDiagnostic(...args));
  const amendMinimal = (...args: Parameters<AiUsageStore["amendMinimalHelloDiagnostic"]>) => withHistoricalAiPolicy(join(directory,"usage.sqlite"), {budgetMicros:144548,dailyMicros:144548,maxCalls:3}, () => ledger.amendMinimalHelloDiagnostic(...args));
  const grant=async()=>{
    const request=prepareMuseHello(),amendment=await amendHello(actor,{confirmed:true,requestHash:request.requestHash,maximumMicros:request.reserveMicros});
    const persisted=await ledger.readHelloAmendment();expect(persisted).toEqual(amendment);
    await ledger.approve(amendment.intentId,actor);
    const provider=new MetaMuseProvider(new ConfigService({MOCK_AI:false,AI_ENABLED:true,AI_MODE:"poc",MODEL_API_KEY:key,AI_DEV_BUDGET_MICROS:amendment.after.budgetMicros,AI_DEV_DAILY_MICROS:amendment.after.dailyMicros,AI_DEV_MAX_CALLS:2,AI_TIMEOUT_MS:1000}),{post:send} as unknown as MetaMuseTransport,ledger);
    return{provider,amendment,request,authorization:{intentId:amendment.intentId,actor,scope:request.scope}};
  };
  const rejectedLegacyDiagnostic=async()=>{
    const {amendment}=await grant();
    ledger.onModuleDestroy();
    const database=new DatabaseSync(join(directory,"usage.sqlite"));
    try{
      const legacy={...amendment,scope:MUSE_HELLO_V1_SCOPE,requestHash:MUSE_HELLO_V1_HASH};
      const audit=JSON.stringify(legacy);
      database.prepare("UPDATE hello_diagnostic_amendment SET record_json=?,checksum=? WHERE id=1").run(audit,createHash("sha256").update(audit).digest("hex"));
      const row=database.prepare("SELECT payload FROM intents WHERE id=?").get(amendment.intentId)!;
      const payload=JSON.stringify({...JSON.parse(String(row.payload)),scope:MUSE_HELLO_V1_SCOPE,requestHash:MUSE_HELLO_V1_HASH,cacheKey:MUSE_HELLO_V1_HASH});
      database.prepare("UPDATE intents SET payload=?,checksum=? WHERE id=?").run(payload,createHash("sha256").update(payload).digest("hex"),amendment.intentId);
    }finally{database.close();}
    const attempt=await ledger.reserve(amendment.intentId,{actor,requestHash:MUSE_HELLO_V1_HASH,scope:MUSE_HELLO_V1_SCOPE,mode:"poc"});
    await ledger.settle(attempt.id,{status:"failed",errorCode:"AI_PROVIDER_FAILED",requestId:"legacy-400"});now+=61000;
    return {attemptId:attempt.id,intentId:amendment.intentId};
  };
  const threeFailedAttempts=async()=>{
    await rejectedLegacyDiagnostic();
    const request=prepareMuseHello(),amendment=await amendCorrected(actor,{confirmed:true,requestHash:request.requestHash,maximumMicros:6544});
    await ledger.approve(amendment.intentId,actor);
    const attempt=await ledger.reserve(amendment.intentId,{actor,requestHash:request.requestHash,scope:request.scope,mode:"poc"});
    await ledger.settle(attempt.id,{status:"failed",errorCode:"AI_INVALID_OUTPUT",requestId:"incomplete-200",inputTokens:10,outputTokens:128,actualMicros:557});now+=61000;
  };
  it("prepares the exact approved minimal/512 bytes, hash and 8196-micro reservation",()=>{
    const request=prepareMinimalMuseHello();
    expect(request).toMatchObject({requestHash:"5ab9516832b50448c3c0a7d786945e9fe8409b9dbbd39b24862898569266a6a5",reserveMicros:8196,maxInputTokens:4816,maxOutputTokens:512});
    expect(JSON.parse(request.payload)).toEqual({model:"muse-spark-1.3",input:"Hello.",reasoning:{effort:"minimal"},max_output_tokens:512,store:false,stream:false,background:false,tools:[],tool_choice:"auto"});
  });
  it("authorizes the final exact request once and preserves three receipts, approvals and demo accounting",async()=>{
    await threeFailedAttempts();const before=await ledger.status(),request=prepareMinimalMuseHello();
    const oldIntents=await Promise.all(before.recentAttempts.map(item=>ledger.readIntent(item.intentId)));
    const confirmation={confirmed:true,requestHash:request.requestHash,maximumMicros:8196},amendment=await amendMinimal(actor,confirmation);
    expect(await ledger.readHelloAmendment()).toEqual(amendment);expect(amendment.after).toEqual({budgetMicros:152744,dailyMicros:152744,maxCalls:4});
    const provider=new MetaMuseProvider(new ConfigService({MOCK_AI:false,AI_ENABLED:true,AI_MODE:"poc",MODEL_API_KEY:key,AI_DEV_BUDGET_MICROS:152744,AI_DEV_DAILY_MICROS:152744,AI_DEV_MAX_CALLS:4}),{post:send} as unknown as MetaMuseTransport,ledger);
    const authorization={intentId:amendment.intentId,actor,scope:request.scope};
    await expect(provider.generateHelloDiagnostic(authorization)).rejects.toMatchObject({code:"AI_APPROVAL_REQUIRED"});expect(send).not.toHaveBeenCalled();
    await expect(provider.generateHelloDiagnostic({...authorization,actor:"b".repeat(64)})).rejects.toMatchObject({code:"AI_APPROVAL_MISMATCH"});
    await expect(ledger.reserve(before.recentAttempts[0].intentId,{actor,scope:prepareMuseHello().scope,requestHash:prepareMuseHello().requestHash,mode:"poc"},{budgetMicros:0,dailyMicros:0,maxCalls:0})).rejects.toMatchObject({code:"AI_APPROVAL_REQUIRED"});
    await ledger.approve(amendment.intentId,actor);
    send.mockResolvedValue({status:200,requestId:"minimal-completed",body:JSON.stringify({status:"completed",model:"muse-spark-1.3",usage:{input_tokens:10,output_tokens:200,output_tokens_details:{reasoning_tokens:160}},output:[{type:"reasoning",content:[{text:"private reasoning not retained"}]},{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"Hello!"}]}]})});
    const results=await Promise.allSettled([provider.generateHelloDiagnostic(authorization),provider.generateHelloDiagnostic(authorization)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toBe(request.payload);
    const result=results.find(result=>result.status==="fulfilled")!;
    expect(result.value).toMatchObject({accepted:true,text:"Hello!",responseStatus:"completed",assistantMessageStatuses:["completed"],inputTokens:10,outputTokens:200,reasoningTokens:160,incompletionReason:null,estimatedActualMicros:863});
    expect(JSON.stringify(result.value)).not.toContain("private reasoning");
    await expect(provider.generateHelloDiagnostic(authorization)).rejects.toBeDefined();
    await expect(amendMinimal(actor,confirmation)).rejects.toMatchObject({code:"AI_DIAGNOSTIC_ALREADY_AUTHORIZED"});
    const after=await ledger.status();expect(after.development).toMatchObject({calls:4,chargedMicros:145411});expect(after.recentAttempts.slice(1)).toEqual(before.recentAttempts);expect(after.demo).toEqual(before.demo);
    expect(await Promise.all(before.recentAttempts.map(item=>ledger.readIntent(item.intentId)))).toEqual(oldIntents);
  });
  it.each(["hash","cost","confirmation","actor","state"])("rejects final diagnostic amendment mismatch %s without mutation",async kind=>{
    if(kind!=="state")await threeFailedAttempts();const before=await ledger.status();
    await expect(amendMinimal(kind==="actor"?"invalid":actor,{confirmed:kind!=="confirmation",requestHash:kind==="hash"?prepareMuseHello().requestHash:prepareMinimalMuseHello().requestHash,maximumMicros:kind==="cost"?8197:8196})).rejects.toBeDefined();
    expect(await ledger.status()).toEqual(before);expect(send).not.toHaveBeenCalled();
  });
  it.each(["reasoning-only","partial-message","message-incomplete","completed","missing-metadata","sensitive-metadata"])("retains only safe completion metadata for %s",async kind=>{
    const {provider,authorization}=await grant();
    const incomplete=["reasoning-only","partial-message","sensitive-metadata"].includes(kind);
    const body={status:incomplete?"incomplete":"completed",model:"muse-spark-1.3",incomplete_details:kind==="missing-metadata"?undefined:{reason:kind==="sensitive-metadata"?`Bearer ${key}`:"max_output_tokens",raw_prompt:"unfiltered prompt must not persist"},usage:{input_tokens:3,output_tokens:20,output_tokens_details:kind==="missing-metadata"?undefined:{reasoning_tokens:14}},output:[{type:"reasoning",content:[{type:"reasoning_text",text:"private raw reasoning must not persist"}]},...kind==="reasoning-only"?[]:[{type:"message",role:"assistant",status:incomplete||kind==="message-incomplete"?"incomplete":"completed",content:[{type:"output_text",text:incomplete?"Partial text must not persist":"Hello!"}]}]]};
    send.mockResolvedValue({status:200,requestId:"safe-correlation",body:JSON.stringify(body)});
    const report=await provider.generateHelloDiagnostic(authorization),valid=["completed","missing-metadata"].includes(kind);
    expect(report).toMatchObject({accepted:valid,text:valid?"Hello!":null,responseStatus:body.status,requestId:"safe-correlation",inputTokens:3,outputTokens:20,reasoningTokens:kind==="missing-metadata"?null:14,incompletionReason:["missing-metadata","sensitive-metadata"].includes(kind)?null:"max_output_tokens",assistantMessageStatuses:kind==="reasoning-only"?[]:[body.output[1].status]});
    if(incomplete)expect(report.errorCode).toBe("AI_TRUNCATED");
    if(kind==="message-incomplete")expect(report.errorCode).toBe("AI_INVALID_OUTPUT");
    for(const forbidden of [key,"private raw reasoning","unfiltered prompt","Partial text"])expect(JSON.stringify(report)).not.toContain(forbidden);
  });
  it("permits only one separately approved corrected request, preserving both historical receipts",async()=>{
    const legacy=await rejectedLegacyDiagnostic(),before=await ledger.status(),oldIntent=await ledger.readIntent(legacy.intentId);
    const request=prepareMuseHello(),confirmation={confirmed:true,requestHash:request.requestHash,maximumMicros:6544};
    const amendment=await amendCorrected(actor,confirmation);
    expect(await ledger.readHelloAmendment()).toEqual(amendment);
    expect(amendment.after).toEqual({budgetMicros:144548,dailyMicros:144548,maxCalls:3});
    expect((await ledger.status()).recentAttempts).toEqual(before.recentAttempts);expect(await ledger.readIntent(legacy.intentId)).toEqual(oldIntent);
    const provider=new MetaMuseProvider(new ConfigService({MOCK_AI:false,AI_ENABLED:true,AI_MODE:"poc",MODEL_API_KEY:key,AI_DEV_BUDGET_MICROS:144548,AI_DEV_DAILY_MICROS:144548,AI_DEV_MAX_CALLS:3}),{post:send} as unknown as MetaMuseTransport,ledger);
    const authorization={intentId:amendment.intentId,actor,scope:request.scope};
    await expect(provider.generateHelloDiagnostic(authorization)).rejects.toMatchObject({code:"AI_APPROVAL_REQUIRED"});expect(send).not.toHaveBeenCalled();
    await expect(ledger.reserve(legacy.intentId,{actor,requestHash:MUSE_HELLO_V1_HASH,scope:MUSE_HELLO_V1_SCOPE,mode:"poc"})).rejects.toMatchObject({code:"AI_APPROVAL_REQUIRED"});
    await ledger.approve(amendment.intentId,actor);
    const result=await provider.generateHelloDiagnostic(authorization);
    expect(result).toMatchObject({accepted:true,text:"Hello!",inputTokens:3,outputTokens:20,estimatedActualMicros:89});
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({input:"Hello.",tool_choice:"auto",tools:[]});
    await expect(provider.generateHelloDiagnostic(authorization)).rejects.toBeDefined();expect(send).toHaveBeenCalledTimes(1);
    await expect(amendCorrected(actor,confirmation)).rejects.toMatchObject({code:"AI_DIAGNOSTIC_ALREADY_AUTHORIZED"});
    const state=await ledger.status();expect(state.development).toMatchObject({calls:3,chargedMicros:138093});expect(state.demo).toEqual(before.demo);
    expect(state.recentAttempts.filter(item=>item.id!==result.attemptId)).toEqual(before.recentAttempts);
  });
  it.each(["cost","hash","confirmation","actor","state"])("rejects corrected amendment mismatch %s without ledger mutation or dispatch",async kind=>{
    if(kind!=="state")await rejectedLegacyDiagnostic();
    const before=await ledger.status(),request=prepareMuseHello();
    await expect(amendCorrected(kind==="actor"?"invalid":actor,{confirmed:kind!=="confirmation",requestHash:kind==="hash"?MUSE_HELLO_V1_HASH:request.requestHash,maximumMicros:kind==="cost"?6545:6544})).rejects.toBeDefined();
    expect(await ledger.status()).toEqual(before);expect(send).not.toHaveBeenCalled();
  });
  it("prepares only literal Hello with 128 tokens, no schema/storage/tools and a sub-cent bound",()=>{
    const request=prepareMuseHello();expect(request.reserveMicros).toBeLessThanOrEqual(10000);
    expect(JSON.parse(request.payload)).toEqual({model:"muse-spark-1.3",input:"Hello.",reasoning:{effort:"low"},max_output_tokens:128,store:false,stream:false,background:false,tools:[],tool_choice:"auto"});
    expect(request.payload).toBe(MUSE_HELLO_PAYLOAD);
    expect(request.requestHash).not.toBe(MUSE_HELLO_V1_HASH);
    expect(request.reserveMicros).toBe(6544);
  });
  it("keeps legacy amendment receipts readable but rejects them for the corrected payload before reservation",async()=>{
    const {provider,amendment,authorization}=await grant();
    // Only this disposable fixture is changed to reproduce the historical audit.
    ledger.onModuleDestroy();
    const database=new DatabaseSync(join(directory,"usage.sqlite"));
    try{
      const legacy={...amendment,scope:MUSE_HELLO_V1_SCOPE,requestHash:MUSE_HELLO_V1_HASH};
      const serialized=JSON.stringify(legacy);
      database.prepare("UPDATE hello_diagnostic_amendment SET record_json=?,checksum=? WHERE id=1").run(serialized,createHash("sha256").update(serialized).digest("hex"));
    }finally{database.close();}
    expect(await ledger.readHelloAmendment()).toMatchObject({scope:MUSE_HELLO_V1_SCOPE,requestHash:MUSE_HELLO_V1_HASH});
    const before=await ledger.status();
    await expect(provider.generateHelloDiagnostic({...authorization,scope:MUSE_HELLO_V1_SCOPE})).rejects.toMatchObject({code:"AI_APPROVAL_MISMATCH"});
    expect(await ledger.status()).toEqual(before);expect(send).not.toHaveBeenCalled();
    const request=prepareMuseHello();
    await expect(amendHello(actor,{confirmed:true,requestHash:request.requestHash,maximumMicros:request.reserveMicros})).rejects.toMatchObject({code:"AI_DIAGNOSTIC_ALREADY_AUTHORIZED"});
  });
  it.each(["hash","cost","confirmation","actor"])("rejects mismatched amendment %s without changing caps",async kind=>{
    const request=prepareMuseHello();
    await expect(amendHello(kind==="actor"?"invalid":actor,{confirmed:kind!=="confirmation",requestHash:kind==="hash"?"0".repeat(64):request.requestHash,maximumMicros:kind==="cost"?10001:request.reserveMicros})).rejects.toBeDefined();
    expect((await ledger.status()).development).toMatchObject({budgetMicros:25000000,dailyMicros:25000000,maxCalls:Number.MAX_SAFE_INTEGER,calls:1,chargedMicros:131460});
    expect(await ledger.readHelloAmendment()).toBeNull();expect(send).not.toHaveBeenCalled();
  });
  it("preserves immutable historical receipts without locking other shared-budget scopes",async()=>{
    const before=await ledger.readIntent(oldIntentId),old=(await ledger.status()).recentAttempts[0];
    const {request,amendment}=await grant();
    expect(amendment.after).toEqual({budgetMicros:131460+request.reserveMicros,dailyMicros:131460+request.reserveMicros,maxCalls:2});
    expect(await ledger.readIntent(oldIntentId)).toEqual(before);expect((await ledger.status()).recentAttempts[0]).toEqual(old);
    await expect(amendHello(actor,{confirmed:true,requestHash:request.requestHash,maximumMicros:request.reserveMicros})).rejects.toMatchObject({code:"AI_DIAGNOSTIC_ALREADY_AUTHORIZED"});
    await expect(ledger.estimate({actor,scope:"unrelated",mode:"poc",requestHash:request.requestHash,cacheKey:request.requestHash,model:request.model,maxInputTokens:request.maxInputTokens,maxOutputTokens:request.maxOutputTokens,reserveMicros:request.reserveMicros,priceVersion:request.priceVersion,reason:"Explicit operation under the shared allowance."},{budgetMicros:0,dailyMicros:0,maxCalls:0})).resolves.toMatchObject({approvedBy:actor});
    await expect(ledger.reserve(oldIntentId,{actor:"old-operator",requestHash:"d4c2fdb6694981d374ed304dd1ecbc477e85d0ed2709cb9c5cf2ea48ddf0aa39",mode:"poc"},{budgetMicros:0,dailyMicros:0,maxCalls:0})).rejects.toMatchObject({code:"AI_APPROVAL_REQUIRED"});
    expect((await ledger.status()).development.budgetMicros).toBe(25000000);
    expect((await ledger.status()).demo).toMatchObject({calls:0,chargedMicros:0,authorization:null});
  });
  it("keeps an unapproved historical intent non-executable without affecting current automatic authorization",async()=>{
    const request=prepareMuseHello(),amendment=await amendHello(actor,{confirmed:true,requestHash:request.requestHash,maximumMicros:request.reserveMicros});
    const provider=new MetaMuseProvider(new ConfigService({AI_ENABLED:true,MOCK_AI:false,AI_MODE:"poc",MODEL_API_KEY:key,AI_DEV_BUDGET_MICROS:amendment.after.budgetMicros,AI_DEV_DAILY_MICROS:amendment.after.dailyMicros,AI_DEV_MAX_CALLS:2}),{post:send} as unknown as MetaMuseTransport,ledger);
    await expect(provider.generateHelloDiagnostic({intentId:amendment.intentId,actor,scope:request.scope})).rejects.toMatchObject({code:"AI_APPROVAL_REQUIRED"});
    expect(send).not.toHaveBeenCalled();expect((await ledger.status()).development.calls).toBe(1);
  });
  it("preserves actor and mock-mode gates for historical diagnostics",async()=>{
    const {provider,authorization}=await grant();
    await expect(provider.generateHelloDiagnostic({...authorization,actor:"b".repeat(64)})).rejects.toMatchObject({code:"AI_APPROVAL_MISMATCH"});
    const disabled=new MetaMuseProvider(new ConfigService({AI_ENABLED:false,MOCK_AI:true,AI_MODE:"mock"}),{post:send} as unknown as MetaMuseTransport,ledger);
    await expect(disabled.generateHelloDiagnostic(authorization)).rejects.toMatchObject({code:"AI_MOCK_MODE"});expect(send).not.toHaveBeenCalled();
  });
  it("dispatches one plain-text request, accounts usage and rejects replay",async()=>{
    const {provider,authorization}=await grant(),before=await ledger.readIntent(oldIntentId);
    const report=await provider.generateHelloDiagnostic(authorization);
    expect(report).toMatchObject({accepted:true,httpStatus:200,requestId:"hello-request",authenticationAccepted:true,requestedModelResponded:true,text:"Hello!",inputTokens:3,outputTokens:20,estimatedActualMicros:89});
    expect(send.mock.calls[0][0]).toBe(MUSE_HELLO_PAYLOAD);
    await expect(provider.generateHelloDiagnostic(authorization)).rejects.toBeDefined();expect(send).toHaveBeenCalledTimes(1);
    expect((await ledger.status()).development).toMatchObject({calls:2,chargedMicros:131549});
    expect(await ledger.readIntent(oldIntentId)).toEqual(before);
  });
  it("serializes parallel attempts through the existing reservation",async()=>{
    const {provider,authorization}=await grant();
    const results=await Promise.allSettled([provider.generateHelloDiagnostic(authorization),provider.generateHelloDiagnostic(authorization)]);
    expect(results.filter(item=>item.status==="fulfilled")).toHaveLength(1);expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([400,401,403,404,422,429,500])("retains HTTP %i diagnostics and one full failed/uncertain reservation",async status=>{
    const {provider,authorization,request}=await grant();send.mockResolvedValue({status,body:"",requestId:"error-request",providerError:{code:"invalid_request",type:"request_error",message:"A precise sanitized fixture failure."}});
    const report=await provider.generateHelloDiagnostic(authorization);
    expect(report).toMatchObject({accepted:false,httpStatus:status,requestId:"error-request",failureStage:"provider-http-rejection",providerError:{code:"invalid_request",message:"A precise sanitized fixture failure."}});
    expect(report.authenticationAccepted).toBe([401,403].includes(status)?false:null);
    expect(report.httpErrorCategory).toBe([401,403].includes(status)?"authentication":status===429?"rate_limit":status===404?"model_or_endpoint":status>=500?"provider_server":"invalid_request");
    expect((await ledger.status()).development.chargedMicros).toBe(131460+request.reserveMicros);
    expect((await ledger.status()).halted).toBe(status===500);
    await expect(provider.generateHelloDiagnostic(authorization)).rejects.toBeDefined();expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(["network","timeout","malformed","incomplete"])("captures %s failure without retry",async kind=>{
    const {provider,authorization}=await grant();
    if(kind==="network")send.mockRejectedValue(new MetaMuseError("AI_NETWORK_ERROR","Offline connection failure."));
    if(kind==="timeout")send.mockImplementation(()=>new Promise(()=>undefined));
    if(kind==="malformed")send.mockResolvedValue({status:200,body:"not JSON",requestId:"bad-response"});
    if(kind==="incomplete")send.mockResolvedValue({status:200,requestId:"incomplete",body:JSON.stringify({status:"incomplete",model:"muse-spark-1.3",usage:{input_tokens:3,output_tokens:128},output:[]})});
    const report=await provider.generateHelloDiagnostic(authorization);expect(report.accepted).toBe(false);expect(send).toHaveBeenCalledTimes(1);
    expect(report.httpStatus).toBe(["malformed","incomplete"].includes(kind)?200:null);
    expect(report.failureStage).toBe(kind==="timeout"?"timeout-before-http-response":kind==="network"?"connection-before-http-response":"response-validation");
    if(kind==="incomplete")expect(report).toMatchObject({responseStatus:"incomplete",requestedModelResponded:true,inputTokens:3,outputTokens:128});
  });
  it("sanitizes error metadata and never retains raw non-200 bodies or credentials",async()=>{
    const stream=new PassThrough();
    Object.assign(stream,{statusCode:400,headers:{"content-type":"application/json","x-request-id":"safe-request"}});
    const pending=readMetaMuseResponse(stream as unknown as IncomingMessage,key);
    stream.end(JSON.stringify({error:{code:"bad_request",type:"invalid_request_error",message:`Invalid request with ${key} and Bearer abcdefghijklmnopqrstuvwxyz1234567890.`},ignored:key}));
    const response=await pending;
    expect(response).toMatchObject({status:400,body:"",requestId:"safe-request",providerError:{code:"bad_request",type:"invalid_request_error"}});
    expect(JSON.stringify(response)).not.toContain(key);expect(JSON.stringify(response)).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");expect(response.providerError?.message).toContain("[redacted]");
  });
});
