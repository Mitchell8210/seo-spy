// Test-only preload: run the real CLI parser with a nondispatching backend.
import process from 'node:process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

if (process.env.NODE_ENV !== 'test' || !process.env.POC_CLI_FIXTURE_LEDGER) throw new Error('Isolated test fixture configuration required.');
const denied = () => { throw new Error('All network and model dispatch are forbidden in the CLI regression fixture.'); };
http.request = http.get = https.request = https.get = net.connect = net.createConnection = tls.connect = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
registerHooks({resolve(specifier, context, next) {
  if (['@nestjs/core', '@nestjs/config'].includes(specifier) || specifier.startsWith('../dist/')) return {url:import.meta.url,shortCircuit:true};
  return next(specifier, context);
}});

export class ConfigService { get(name) { return name === 'AI_DEV_BUDGET_MICROS' ? 0 : undefined; } }
export class AppModule {}
export class AssessmentAnalysisService {}
export class AssessmentStore {}
export class AiUsageStore {}
export class MetaMuseTransport { post = denied; }
const instances = new Map();
export const NestFactory = {async createApplicationContext() {
  return {get(Type) { if (!instances.has(Type)) instances.set(Type, new Type()); return instances.get(Type); }, async close() {}};
}};
export class AssessmentPocOperator {
  async approve(businessId, assessmentId, credential, confirmation) {
    if (!credential || credential !== process.env.AI_ADMIN_KEY || credential !== process.env.SEO_SPY_AI_ADMIN_TOKEN) throw new Error('The fixture credential was not passed through the private environment.');
    const payload = {businessId,assessmentId,confirmation,credentialPassedPrivately:true,argvContainsCredential:process.argv.some(arg=>arg.includes(credential))};
    if (payload.argvContainsCredential) throw new Error('Credential must not appear in arguments.');
    // This disposable fixture DB records argument delivery only. It is not a
    // production authorization, budget allowance, intent or spending reservation.
    const database = new DatabaseSync(process.env.POC_CLI_FIXTURE_LEDGER);
    try {
      database.exec('CREATE TABLE received_arguments(payload TEXT NOT NULL)');
      database.prepare('INSERT INTO received_arguments(payload) VALUES(?)').run(JSON.stringify(payload));
    } finally { database.close(); }
    return {stage:'approved',fixtureOnly:true,modelDispatches:0};
  }
  execute() { throw new Error('Execution is forbidden in this argument-handling fixture.'); }
}
export class AssessmentTestingOperator extends AssessmentPocOperator {
  constructor(...args) { super(); this.selectionVersion = args[6] ?? 'v3'; }
  async approveTesting(...args) { return { ...await this.approve(...args), selectionVersion: this.selectionVersion }; }
  executeTesting() { throw new Error('Execution is forbidden in this argument-handling fixture.'); }
}
