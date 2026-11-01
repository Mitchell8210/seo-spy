import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { GOOGLE_READ_SCOPES, ServiceAccountGoogleTokenProvider } from "../src/integrations/google/google-auth.js";
import { GoogleApiError, GOOGLE_TOKEN_URL, type GoogleTransport } from "../src/integrations/google/google-transport.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("Google service-account authorization with generated offline credentials", () => {
  let directory: string;
  let path: string;
  let settings: Record<string, unknown>;
  let post: ReturnType<typeof jest.fn<GoogleTransport["post"]>>;
  let provider: ServiceAccountGoogleTokenProvider;
  const credentials = (patch: object = {}) => ({ type: "service_account", client_email: "fixture-account@example.test", private_key: pem, token_uri: GOOGLE_TOKEN_URL, ...patch });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-google-auth-"));
    path = join(directory, "fixture.json");
    await writeFile(path, JSON.stringify(credentials()));
    settings = { GOOGLE_APPLICATION_CREDENTIALS: path };
    post = jest.fn<GoogleTransport["post"]>().mockResolvedValue({ access_token: "fixture-server-only-access", token_type: "Bearer", expires_in: 3600 });
    provider = new ServiceAccountGoogleTokenProvider(new ConfigService(settings), { post } as unknown as GoogleTransport);
  });
  afterEach(async () => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-google-auth-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("signs a bounded read-only JWT and keeps identity/assertion out of the cache key", async () => {
    const fingerprint = await provider.authorizationCacheKey();
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(post).not.toHaveBeenCalled();
    expect(await provider.getAccessToken()).toBe("fixture-server-only-access");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(GOOGLE_TOKEN_URL);
    expect(post.mock.calls[0][2]).toEqual({ contentType: "application/x-www-form-urlencoded" });
    const input = new URLSearchParams(String(post.mock.calls[0][1]));
    expect(input.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const parts = input.get("assertion")!.split(".");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toMatchObject({ iss: "fixture-account@example.test", aud: GOOGLE_TOKEN_URL, scope: GOOGLE_READ_SCOPES.join(" ") });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(claims).not.toHaveProperty("sub");
    expect(verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), keys.publicKey, Buffer.from(parts[2], "base64url"))).toBe(true);
    expect(fingerprint).not.toContain("fixture-account");
    expect(fingerprint).not.toContain(pem);
  });
  it("caches a usable token and deduplicates concurrent exchanges", async () => {
    let finish!: (value: unknown) => void;
    post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    // Both asynchronous file reads finish before the exchange can be resolved.
    for (let turn = 0; turn < 50 && !finish; turn++) await new Promise(resolve => setTimeout(resolve, 2));
    expect(finish).toBeDefined();
    finish({ access_token: "one-shared-token", token_type: "Bearer", expires_in: 3600 });
    expect(await first).toBe("one-shared-token");
    expect(await second).toBe("one-shared-token");
    expect(await provider.getAccessToken()).toBe("one-shared-token");
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("refreshes once near expiry and changes cache identity when the service account changes", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-31T00:00:00.000Z"));
    const original = await provider.authorizationCacheKey();
    await provider.getAccessToken();
    clock.mockReturnValue(Date.parse("2026-10-31T00:59:01.000Z"));
    await provider.getAccessToken();
    expect(post).toHaveBeenCalledTimes(2);
    await writeFile(path, JSON.stringify(credentials({ client_email: "other-account@example.test" })));
    expect(await provider.authorizationCacheKey()).not.toBe(original);
    await provider.getAccessToken();
    expect(post).toHaveBeenCalledTimes(3);
  });
  it.each([
    { type: "authorized_user" }, { client_email: "not-an-email" }, { private_key: "invalid private fixture" },
    { token_uri: "https://attacker.example/token" }, { private_key: generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
  ])("rejects invalid account credentials before any exchange %j", async patch => {
    await writeFile(path, JSON.stringify(credentials(patch)));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    expect(post).not.toHaveBeenCalled();
  });
  it("fails safely for missing configuration, missing/oversized/malformed files and never logs a key/path", async () => {
    settings.GOOGLE_APPLICATION_CREDENTIALS = "";
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    settings.GOOGLE_APPLICATION_CREDENTIALS = join(directory, "missing.json");
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    settings.GOOGLE_APPLICATION_CREDENTIALS = path;
    for (const body of ["{private invalid JSON", "x".repeat(65537)]) {
      await writeFile(path, body);
      try { await provider.getAccessToken(); throw new Error("Expected rejection"); }
      catch (error) { expect(error).toBeInstanceOf(GoogleApiError); expect(String(error)).not.toContain(directory); expect(String(error)).not.toContain("private invalid"); }
    }
    expect(post).not.toHaveBeenCalled();
  });
  it("rejects linked credential files and linked immediate parent directories", async () => {
    const linked = join(directory, "linked.json");
    try { await symlink(path, linked, "file"); }
    catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EPERM")) throw error; }
    settings.GOOGLE_APPLICATION_CREDENTIALS = linked;
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    const actual = join(directory, "actual"); await mkdir(actual);
    await writeFile(join(actual, "credentials.json"), JSON.stringify(credentials()));
    const alias = join(directory, "alias"); await symlink(actual, alias, "junction");
    settings.GOOGLE_APPLICATION_CREDENTIALS = join(alias, "credentials.json");
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    expect(post).not.toHaveBeenCalled();
  });
  it.each([
    {}, { access_token: "secret", token_type: "Bearer", expires_in: 60 },
    { access_token: "secret", token_type: "Bearer", expires_in: 3601 },
    { access_token: "secret\nheader", token_type: "Bearer", expires_in: 3600 },
    { access_token: "secret", token_type: "Other", expires_in: 3600 },
  ])("rejects incompatible token responses without retry %j", async response => {
    post.mockResolvedValue(response);
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "GOOGLE_AUTH_FAILED" });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("does not automatically retry or preserve raw unexpected transport failures", async () => {
    post.mockRejectedValue(new Error(`${pem} private fixture path ${directory}`));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "GOOGLE_AUTH_FAILED", message: "Google service-account authorization could not be completed." });
    expect(post).toHaveBeenCalledTimes(1);
    // A later explicit caller may retry after an issue is fixed; there is no hidden retry loop.
    post.mockResolvedValue({ access_token: "repaired-token", token_type: "Bearer", expires_in: 3600 });
    expect(await provider.getAccessToken()).toBe("repaired-token");
    expect(post).toHaveBeenCalledTimes(2);
  });
});
