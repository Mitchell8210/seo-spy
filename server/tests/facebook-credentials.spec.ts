import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  copyFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  FacebookCredentialsStore,
  FacebookCredentialStoreError,
  type FacebookCredential,
} from "../src/modules/facebook/facebook-credentials.store.js";

describe("encrypted local Facebook credentials", () => {
  let root: string;
  let key: string;
  let store: FacebookCredentialsStore;
  const id = "ab".repeat(32);
  const otherId = "cd".repeat(32);
  const credential: FacebookCredential = {
    token: "private-facebook-user-access-token",
    expiresAt: 1234567,
    dataAccessExpiresAt: null,
    createdAt: "2026-10-29T17:00:00.000Z",
  };
  const filename = (value: string) =>
    `${createHash("sha256").update(value).digest("hex")}.json`;
  const create = (tokenKey = key) =>
    new FacebookCredentialsStore(
      new ConfigService({
        FACEBOOK_TOKEN_KEY: tokenKey,
        FACEBOOK_CONNECTIONS_DIR: root,
      }),
    );

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "seo-spy-facebook-credentials-"));
    key = randomBytes(32).toString("base64");
    store = create();
  });
  afterEach(async () => {
    const target = resolve(root);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("seo-spy-facebook-credentials-")
    )
      throw new Error("Unsafe test cleanup");
    await rm(target, { recursive: true, force: true });
  });

  it("round-trips across instances without storing plaintext tokens, keys, or session handles", async () => {
    await store.save(id, credential);
    const names = await readdir(root);
    expect(names).toEqual([filename(id)]);
    const raw = await readFile(join(root, names[0]!), "utf8");
    expect(raw).not.toContain(credential.token);
    expect(raw).not.toContain(id);
    expect(raw).not.toContain(key);
    expect(raw).not.toContain(credential.createdAt);
    expect(await create().read(id)).toEqual(credential);
    // Expiry remains metadata: the OAuth connection service decides when to reconnect.
    expect((await store.read(id))?.expiresAt).toBe(1234567);
    if (process.platform !== "win32")
      expect((await stat(join(root, names[0]!))).mode & 0o777).toBe(0o600);
  });

  it("uses fresh authenticated encryption on overwrite and removes a persisted connection", async () => {
    await store.save(id, credential);
    const initial = await readFile(join(root, filename(id)), "utf8");
    await store.save(id, { ...credential, token: "replacement-private-token" });
    expect(await readFile(join(root, filename(id)), "utf8")).not.toBe(initial);
    expect(await create().read(id)).toEqual({
      ...credential,
      token: "replacement-private-token",
    });
    await store.remove(id);
    expect(await store.read(id)).toBeNull();
    await expect(store.remove(id)).resolves.toBeUndefined();
  });

  it("fails closed for a wrong key, tampering, or moving ciphertext to another session", async () => {
    await store.save(id, credential);
    await expect(
      create(randomBytes(32).toString("base64")).read(id),
    ).rejects.toBeInstanceOf(FacebookCredentialStoreError);
    await copyFile(join(root, filename(id)), join(root, filename(otherId)));
    await expect(store.read(otherId)).rejects.toBeInstanceOf(
      FacebookCredentialStoreError,
    );
    const envelope = JSON.parse(
      await readFile(join(root, filename(id)), "utf8"),
    ) as { ciphertext: string };
    envelope.ciphertext = Buffer.from("tampered credential").toString("base64");
    await writeFile(join(root, filename(id)), JSON.stringify(envelope));
    await expect(store.read(id)).rejects.toThrow(
      "The encrypted Facebook connection store could not be accessed.",
    );
  });

  it("does not require a key at startup but rejects missing or malformed keys on credential access", async () => {
    for (const invalid of ["", "invalid", randomBytes(16).toString("base64")]) {
      const noKey = create(invalid);
      await expect(noKey.save(id, credential)).rejects.toBeInstanceOf(
        FacebookCredentialStoreError,
      );
      await expect(noKey.read(id)).rejects.toBeInstanceOf(
        FacebookCredentialStoreError,
      );
    }
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects unsafe ids, malformed credentials, and oversized stored files without exposing secrets", async () => {
    for (const invalid of ["../escape", "", "a".repeat(63), "Z".repeat(64)]) {
      await expect(store.save(invalid, credential)).rejects.toBeInstanceOf(
        FacebookCredentialStoreError,
      );
      await expect(store.read(invalid)).rejects.toBeInstanceOf(
        FacebookCredentialStoreError,
      );
      await expect(store.remove(invalid)).rejects.toBeInstanceOf(
        FacebookCredentialStoreError,
      );
    }
    await expect(
      store.save(id, { ...credential, expiresAt: Number.NaN }),
    ).rejects.toBeInstanceOf(FacebookCredentialStoreError);
    await writeFile(join(root, filename(id)), "x".repeat(128 * 1024 + 1));
    const error: unknown = await store
      .read(id)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FacebookCredentialStoreError);
    expect(String(error)).not.toContain(credential.token);
    expect(String(error)).not.toContain(key);
  });
});
