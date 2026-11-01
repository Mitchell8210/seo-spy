import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleApiError, GoogleTransport, GOOGLE_TOKEN_URL } from "./google-transport.js";

export const GOOGLE_TOKEN_PROVIDER = Symbol("GOOGLE_TOKEN_PROVIDER");
export interface GoogleTokenProvider {
  getAccessToken(): Promise<string>;
  authorizationCacheKey(): Promise<string>;
}
export const GOOGLE_READ_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly"] as const;
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const invalid = () => new GoogleApiError("GOOGLE_NOT_CONFIGURED", "Valid server-side Google service-account credentials are required.");
const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

@Injectable()
export class ServiceAccountGoogleTokenProvider implements GoogleTokenProvider {
  private cached: { fingerprint: string; token: string; expiresAt: number } | null = null;
  private pending: { fingerprint: string; promise: Promise<string> } | null = null;
  constructor(private readonly config: ConfigService, private readonly transport: GoogleTransport) {}

  private async credentials() {
    try {
      const configured = this.config.get<string>("GOOGLE_APPLICATION_CREDENTIALS") ?? "";
      if (!configured.trim()) throw invalid();
      const path = resolve(fileURLToPath(new URL("../../../", import.meta.url)), configured);
      const directory = await lstat(dirname(path));
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw invalid();
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CREDENTIAL_BYTES) throw invalid();
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let value: unknown;
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size > MAX_CREDENTIAL_BYTES || opened.ino !== info.ino || opened.dev !== info.dev) throw invalid();
        const bytes = Buffer.alloc(opened.size + 1);
        let used = 0;
        while (used < bytes.length) {
          const read = await handle.read(bytes, used, bytes.length - used, null);
          if (!read.bytesRead) break;
          used += read.bytesRead;
        }
        if (used !== opened.size) throw invalid();
        value = JSON.parse(bytes.subarray(0, used).toString("utf8"));
      } finally { await handle.close(); }
      const source = object(value);
      if (source.type !== "service_account" || typeof source.client_email !== "string" || source.client_email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source.client_email) || typeof source.private_key !== "string" || source.private_key.length > MAX_CREDENTIAL_BYTES || source.token_uri !== undefined && source.token_uri !== GOOGLE_TOKEN_URL) throw invalid();
      const privateKey = createPrivateKey(source.private_key);
      if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw invalid();
      const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
      const fingerprint = digest(JSON.stringify({ clientEmail: source.client_email, publicKey, scopes: GOOGLE_READ_SCOPES }));
      return { email: source.client_email, privateKey, fingerprint };
    } catch { throw invalid(); }
  }
  async authorizationCacheKey(): Promise<string> { return (await this.credentials()).fingerprint; }

  async getAccessToken(): Promise<string> {
    const credentials = await this.credentials();
    const now = Date.now();
    if (this.cached?.fingerprint === credentials.fingerprint && this.cached.expiresAt - 60000 > now) return this.cached.token;
    if (this.pending?.fingerprint === credentials.fingerprint) return this.pending.promise;
    const promise = this.exchange(credentials);
    this.pending = { fingerprint: credentials.fingerprint, promise };
    try { return await promise; }
    finally { if (this.pending?.promise === promise) this.pending = null; }
  }

  private async exchange(credentials: Awaited<ReturnType<ServiceAccountGoogleTokenProvider["credentials"]>>): Promise<string> {
    const now = Date.now();
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    let assertion: string;
    try {
      const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: credentials.email, scope: GOOGLE_READ_SCOPES.join(" "), aud: GOOGLE_TOKEN_URL, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 })}`;
      assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), credentials.privateKey).toString("base64url")}`;
    } catch { throw invalid(); }
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString();
    let response: unknown;
    try { response = await this.transport.post(GOOGLE_TOKEN_URL, body, { contentType: "application/x-www-form-urlencoded" }); }
    catch (error) { if (error instanceof GoogleApiError) throw error; throw new GoogleApiError("GOOGLE_AUTH_FAILED", "Google service-account authorization could not be completed."); }
    const token = object(response);
    if (typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 8192 || /[\r\n]/.test(token.access_token) || token.token_type !== "Bearer" || !Number.isInteger(token.expires_in) || Number(token.expires_in) <= 60 || Number(token.expires_in) > 3600) throw new GoogleApiError("GOOGLE_AUTH_FAILED", "Google returned an incompatible authorization response.");
    this.cached = { fingerprint: credentials.fingerprint, token: token.access_token, expiresAt: now + Number(token.expires_in) * 1000 };
    return token.access_token;
  }
}
