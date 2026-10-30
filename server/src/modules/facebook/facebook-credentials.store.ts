import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export interface FacebookCredential {
  token: string;
  expiresAt: number | null;
  dataAccessExpiresAt?: number | null;
  createdAt: string;
}

export class FacebookCredentialStoreError extends Error {
  readonly code = "FACEBOOK_CREDENTIAL_STORE_UNAVAILABLE";
  constructor() {
    super(
      "The encrypted Facebook connection store could not be accessed. Check local storage and encryption key configuration.",
    );
  }
}

const VERSION = "seo-spy.facebook-credential.v1";
const MAX_BYTES = 128 * 1024;
const credentialSchema = z.object({
  token: z.string().min(1).max(32768),
  expiresAt: z.number().finite().nonnegative().nullable(),
  dataAccessExpiresAt: z.number().finite().nonnegative().nullable().optional(),
  createdAt: z
    .string()
    .max(64)
    .refine((value) => Number.isFinite(Date.parse(value))),
});
const envelopeSchema = z.object({
  version: z.literal(VERSION),
  nonce: z.string().max(32),
  tag: z.string().max(32),
  ciphertext: z.string().max(MAX_BYTES),
});
const hasCode = (error: unknown, code: string) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === code;

@Injectable()
export class FacebookCredentialsStore {
  private readonly directory: string;

  constructor(private readonly config: ConfigService) {
    this.directory = resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
      config.get<string>("FACEBOOK_CONNECTIONS_DIR") ??
        "reports/facebook-connections",
    );
  }

  private key(): Buffer {
    const raw = this.config.get<string>("FACEBOOK_TOKEN_KEY") ?? "";
    const key = Buffer.from(raw, "base64");
    if (key.byteLength !== 32 || key.toString("base64") !== raw)
      throw new FacebookCredentialStoreError();
    return key;
  }

  private target(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new FacebookCredentialStoreError();
    const digest = createHash("sha256").update(id).digest("hex");
    return {
      path: join(this.directory, `${digest}.json`),
      aad: Buffer.from(`${VERSION}:${digest}`, "utf8"),
    };
  }

  private async checkDirectory(create = false) {
    if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new FacebookCredentialStoreError();
  }

  async save(id: string, credential: FacebookCredential): Promise<void> {
    let temporary: string | undefined;
    try {
      const { path, aad } = this.target(id);
      const key = this.key();
      const clean = credentialSchema.parse(credential);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(clean), "utf8"),
        cipher.final(),
      ]);
      const json = JSON.stringify({
        version: VERSION,
        nonce: nonce.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      });
      if (Buffer.byteLength(json) > MAX_BYTES)
        throw new FacebookCredentialStoreError();
      await this.checkDirectory(true);
      try {
        const existing = await lstat(path);
        if (!existing.isFile() || existing.isSymbolicLink())
          throw new FacebookCredentialStoreError();
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      temporary = join(
        this.directory,
        `.${randomBytes(24).toString("hex")}.tmp`,
      );
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(json, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      temporary = undefined;
    } catch {
      throw new FacebookCredentialStoreError();
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
  }

  async read(id: string): Promise<FacebookCredential | null> {
    try {
      const { path, aad } = this.target(id);
      const key = this.key();
      await this.checkDirectory();
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES)
        throw new FacebookCredentialStoreError();
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      let json: string;
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          stat.size > MAX_BYTES ||
          stat.ino !== info.ino ||
          stat.dev !== info.dev
        )
          throw new FacebookCredentialStoreError();
        const buffer = Buffer.alloc(stat.size + 1);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            size,
            buffer.length - size,
            null,
          );
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size !== stat.size) throw new FacebookCredentialStoreError();
        json = buffer.subarray(0, size).toString("utf8");
      } finally {
        await handle.close();
      }
      const envelope = envelopeSchema.parse(JSON.parse(json));
      const nonce = Buffer.from(envelope.nonce, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      if (nonce.length !== 12 || tag.length !== 16)
        throw new FacebookCredentialStoreError();
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
      return credentialSchema.parse(JSON.parse(decrypted.toString("utf8")));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw new FacebookCredentialStoreError();
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const { path } = this.target(id);
      await this.checkDirectory();
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new FacebookCredentialStoreError();
      await unlink(path);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw new FacebookCredentialStoreError();
    }
  }
}
