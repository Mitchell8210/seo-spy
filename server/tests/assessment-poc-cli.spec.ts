import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

describe("POC credential launcher argument regression (no real backend or network)", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cli = join(root, "scripts/assessment-muse-poc.mjs");
  const preload = join(root, "tests/fixtures/assessment-poc-cli.fixture.mjs");
  let directory: string, ledger: string, secret: string, environmentFile: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "seo-spy-cli-args-test-"));
    ledger = join(directory, "argument-fixture.sqlite");
    secret = randomBytes(32).toString("hex");
    environmentFile = join(directory, "fixture.env");
    writeFileSync(environmentFile, `AI_ADMIN_KEY=${secret}\n`, {mode:0o600});
  });
  afterEach(() => {
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    rmSync(directory, {recursive:true});
  });
  const options = () => ["--business-id=fixture-business", "--assessment-id=00000000-0000-4000-8000-000000000001", `--request-hash=${"a".repeat(64)}`, `--input-hash=${"b".repeat(64)}`,
    "--maximum-micros=131460", "--authorize-one-request", "--confirmed", "--reason=Offline isolated argument delivery test"];
  function invoke(style: "script" | "eval", args: string[], credential = true) {
    // Do not inherit private configuration, model keys, proxy hooks or NODE_OPTIONS.
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) if (/^(path|pathext|systemroot|windir|temp|tmp)$/i.test(name) && value !== undefined) env[name] = value;
    Object.assign(env, {NODE_ENV:"test",POC_CLI_FIXTURE_LEDGER:ledger,MOCK_AI:"true",AI_MODE:"mock",AI_ENABLED:"false",MODEL_API_KEY:""});
    const prefix = [`--env-file=${environmentFile}`, "--import", pathToFileURL(preload).href];
    if (style === "script") {
      if (credential) env.SEO_SPY_AI_ADMIN_TOKEN = secret;
      prefix.push(cli);
    } else {
      // This is the original normalized-argv eval launcher, with no secret in code/argv.
      const code = `${credential ? "process.env.SEO_SPY_AI_ADMIN_TOKEN=process.env.AI_ADMIN_KEY;" : ""}process.argv.splice(1,0,${JSON.stringify(cli)});await import(${JSON.stringify(pathToFileURL(cli).href)});`;
      prefix.push("--input-type=module", "-e", code);
    }
    const child = spawnSync(process.execPath, [...prefix, ...args], {cwd:directory,env,encoding:"utf8",timeout:15000,windowsHide:true});
    expect(child.error).toBeUndefined();
    expect(child.stdout.includes(secret)).toBe(false); expect(child.stderr.includes(secret)).toBe(false);
    return child;
  }
  it.each(["script", "eval"] as const)("delivers exactly one approve stage and the full confirmation through %s invocation", style => {
    const child = invoke(style, ["approve", ...options()]);
    expect({status:child.status,stderr:child.stderr}).toMatchObject({status:0});
    const output = JSON.parse(child.stdout) as {fixtureOnly:boolean;metaDispatches:number;networkRequests:number};
    expect(output).toMatchObject({fixtureOnly:true,metaDispatches:0,networkRequests:0});
    const db = new DatabaseSync(ledger, {readOnly:true});
    try {
      const payload = JSON.parse(String(db.prepare("SELECT payload FROM received_arguments").get()!.payload));
      expect(payload).toEqual({businessId:"fixture-business",assessmentId:"00000000-0000-4000-8000-000000000001",confirmation:{confirmed:true,requestHash:"a".repeat(64),inputHash:"b".repeat(64),maximumMicros:131460,authorizeOneRequest:true,reason:"Offline isolated argument delivery test"},credentialPassedPrivately:true,argvContainsCredential:false});
    } finally { db.close(); }
  });
  it("reproduces Node's faulty inferred eval argument slice independently", () => {
    const code = 'import {parseArgs} from "node:util";process.argv.splice(1,0,"fixture-script.mjs");const opts={allowPositionals:true,strict:true};console.log(JSON.stringify({inferred:parseArgs(opts).positionals,explicit:parseArgs({...opts,args:process.argv.slice(2)}).positionals}));';
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, "approve"], {encoding:"utf8",windowsHide:true});
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({inferred:["fixture-script.mjs","approve"],explicit:["approve"]});
  });
  it.each((["script", "eval"] as const).flatMap(style => (["v4", "v5"] as const).map(version => ({ style, version }))))("delivers explicit $version selection through $style invocation", ({ style, version }) => {
    const child = invoke(style, ["approve", "--testing", `--selection-version=${version}`, ...options()]);
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({ selectionVersion: version, fixtureOnly: true, metaDispatches: 0, networkRequests: 0 });
  });
  it.each(["unsupported-version", "without-testing", "new-activation"])("rejects %s before backend or ledger access", kind => {
    const args = [kind === "new-activation" ? "activate" : "approve", "--selection-version=v5", ...options()];
    if (kind !== "without-testing") args.push("--testing");
    if (kind === "unsupported-version") args[1] = "--selection-version=v9";
    if (kind === "new-activation") args.push(`--policy-hash=${"c".repeat(64)}`);
    expect(invoke("script", args).status).not.toBe(0);
    expect(existsSync(ledger)).toBe(false);
  });
  it.each(["extra-stage", "missing-cost", "bad-hash", "unknown-option", "no-confirmation"])("rejects %s before fixture authorization or ledger creation", kind => {
    let args = ["approve", ...options()];
    if (kind === "extra-stage") args.push("execute");
    if (kind === "missing-cost") args = args.filter(arg => !arg.startsWith("--maximum-micros="));
    if (kind === "bad-hash") args = args.map(arg => arg.startsWith("--request-hash=") ? "--request-hash=invalid" : arg);
    if (kind === "unknown-option") args.push("--unrecognized");
    if (kind === "no-confirmation") args = args.filter(arg => arg !== "--confirmed");
    expect(invoke("eval", args).status).not.toBe(0);
    expect(existsSync(ledger)).toBe(false);
  });
  it("rejects missing private credentials without mutating the fixture ledger", () => {
    expect(invoke("eval", ["approve", ...options()], false).status).not.toBe(0);
    expect(existsSync(ledger)).toBe(false);
  });
  it("cannot dispatch even if execute is selected inside this fixture", () => {
    const child = invoke("eval", ["execute", ...options(), "--poc", "--intent-id=00000000-0000-4000-8000-000000000002"]);
    expect(child.status).not.toBe(0);
    expect(JSON.parse(child.stderr.split(/\r?\n/).find(line=>line.startsWith("{"))!)).toMatchObject({accepted:false,metaDispatches:0,networkRequests:0});
    expect(existsSync(ledger)).toBe(false);
  });
});
