import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import {
  FacebookCredentialsStore,
  type FacebookCredential,
} from "./facebook-credentials.store.js";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

export const READ_PERMISSIONS = [
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
  "pages_read_user_content",
  "business_management",
];
const WRITE_PERMISSIONS = [
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_manage_metadata",
];
const object = z.record(z.string(), z.unknown());
export class FacebookError extends Error {
  constructor(
    public readonly code: string,
    public readonly providerCode?: number,
    public readonly providerSubcode?: number,
  ) {
    super(code);
  }
}

@Injectable()
export class FacebookGraph {
  constructor(private readonly config: ConfigService) {}
  get graphVersion(): string {
    return this.config.getOrThrow<string>("FACEBOOK_GRAPH_VERSION");
  }
  async request(
    path: string,
    token: string,
    params: Record<string, string> = {},
    secretProof = true,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const url = new URL(
      `https://graph.facebook.com/${this.config.getOrThrow<string>("FACEBOOK_GRAPH_VERSION")}/${path}`,
    );
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const secret = this.config.get<string>("FACEBOOK_APP_SECRET");
    if (secret && secretProof)
      url.searchParams.set(
        "appsecret_proof",
        createHmac("sha256", secret).update(token).digest("hex"),
      );
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
      if (!response.body) throw new FacebookError("EMPTY_RESPONSE");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024)
            throw new FacebookError("RESPONSE_TOO_LARGE");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const body = object.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (!response.ok || body.error) {
        const error = object.safeParse(body.error);
        throw new FacebookError(
          "PROVIDER_REJECTED",
          error.success && typeof error.data.code === "number"
            ? error.data.code
            : undefined,
          error.success && typeof error.data.error_subcode === "number"
            ? error.data.error_subcode
            : undefined,
        );
      }
      return body;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof FacebookError) throw error;
      throw new FacebookError("PROVIDER_UNAVAILABLE");
    }
  }
}

type Session = {
  expires: number;
  token?: string;
  state?: string;
  timer?: ReturnType<typeof setTimeout>;
};
@Injectable()
export class FacebookService implements OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly config: ConfigService,
    private readonly graph: FacebookGraph,
    @Optional() private readonly credentials?: FacebookCredentialsStore,
  ) {}
  onModuleDestroy() {
    for (const id of this.sessions.keys()) this.forget(id);
  }
  settings() {
    const has = (key: string) => Boolean(this.config.get<string>(key));
    return {
      mode: "local-testing",
      appIdConfigured: has("FACEBOOK_APP_ID"),
      appSecretConfigured: has("FACEBOOK_APP_SECRET"),
      configIdConfigured: has("FACEBOOK_CONFIG_ID"),
      tokenEncryptionConfigured: has("FACEBOOK_TOKEN_KEY"),
      accessTokenConfigured: has("FACEBOOK_ACCESS_TOKEN"),
      redirectUri: this.config.getOrThrow<string>("FACEBOOK_REDIRECT_URI"),
      graphVersion: this.config.getOrThrow<string>("FACEBOOK_GRAPH_VERSION"),
      requiredPermissions: READ_PERMISSIONS,
      writesEnabled: false,
    };
  }
  private create(session: Omit<Session, "expires" | "timer">) {
    for (const [id, value] of this.sessions)
      if (value.expires < Date.now()) this.forget(id);
    if (this.sessions.size >= 100)
      throw new BadRequestException(
        "Too many test sessions. Restart the local server.",
      );
    const id = randomBytes(32).toString("hex");
    const lifetime = session.state ? 600000 : 3600000;
    const timer = setTimeout(() => this.forget(id), lifetime);
    timer.unref();
    this.sessions.set(id, {
      ...session,
      expires: Date.now() + lifetime,
      timer,
    });
    return id;
  }
  private get(id: string | undefined) {
    const session = id ? this.sessions.get(id) : undefined;
    if (!session || session.expires < Date.now()) {
      if (id) this.forget(id);
      throw new BadRequestException({
        code: "FACEBOOK_SESSION_REQUIRED",
        message: "Start or reconnect your local Facebook test session.",
      });
    }
    return session;
  }
  forget(id?: string) {
    if (!id) return;
    const session = this.sessions.get(id);
    if (session?.timer) clearTimeout(session.timer);
    this.sessions.delete(id);
  }
  start() {
    const settings = this.settings();
    if (
      !settings.appIdConfigured ||
      !settings.appSecretConfigured ||
      !settings.configIdConfigured
    )
      throw new BadRequestException({
        code: "FACEBOOK_CONFIGURATION_REQUIRED",
        message:
          "Configure FACEBOOK_APP_ID, FACEBOOK_APP_SECRET and FACEBOOK_CONFIG_ID on the server.",
      });
    if (this.credentials && !settings.tokenEncryptionConfigured)
      throw new BadRequestException(
        "Configure FACEBOOK_TOKEN_KEY before connecting Facebook.",
      );
    const state = randomBytes(32).toString("hex");
    const id = this.create({ state });
    const url = new URL(
      `https://www.facebook.com/${settings.graphVersion}/dialog/oauth`,
    );
    url.search = new URLSearchParams({
      client_id: this.config.getOrThrow<string>("FACEBOOK_APP_ID"),
      config_id: this.config.getOrThrow<string>("FACEBOOK_CONFIG_ID"),
      redirect_uri: settings.redirectUri,
      response_type: "code",
      state,
    }).toString();
    return { id, url: url.toString() };
  }
  useConfiguredToken() {
    const token = this.config.get<string>("FACEBOOK_ACCESS_TOKEN");
    if (!token)
      throw new BadRequestException(
        "Configure FACEBOOK_ACCESS_TOKEN on the server first.",
      );
    return this.create({ token });
  }
  async callback(
    id: string | undefined,
    state: unknown,
    code: unknown,
    denied: boolean,
  ) {
    const session = this.get(id);
    if (typeof state !== "string" || !session.state || state !== session.state)
      throw new BadRequestException("Invalid Facebook authorization state.");
    this.forget(id);
    if (
      denied ||
      typeof code !== "string" ||
      !code.length ||
      code.length > 4096
    )
      throw new BadRequestException(
        "Facebook authorization was cancelled or did not return a code.",
      );
    let result: Record<string, unknown>;
    try {
      result = await this.graph.request(
        "oauth/access_token",
        "",
        {
          client_id: this.config.getOrThrow<string>("FACEBOOK_APP_ID"),
          client_secret: this.config.getOrThrow<string>("FACEBOOK_APP_SECRET"),
          redirect_uri: this.settings().redirectUri,
          code,
        },
        false,
      );
    } catch {
      throw new BadRequestException({
        code: "FACEBOOK_EXCHANGE_FAILED",
        message:
          "Facebook rejected the authorization exchange. Check the app credentials, login configuration and redirect URI.",
      });
    }
    const token = z.string().min(1).safeParse(result.access_token);
    if (!token.success)
      throw new BadRequestException(
        "Facebook returned no usable access token.",
      );
    if (!this.credentials || !this.config.get<string>("FACEBOOK_TOKEN_KEY"))
      throw new BadRequestException(
        "Configure encrypted credential storage before connecting Facebook.",
      );
    try {
      const longLived = z
        .object({
          access_token: z.string().min(1),
          expires_in: z.number().positive().optional(),
        })
        .parse(
          await this.graph.request(
            "oauth/access_token",
            "",
            {
              grant_type: "fb_exchange_token",
              client_id: this.config.getOrThrow<string>("FACEBOOK_APP_ID"),
              client_secret: this.config.getOrThrow<string>(
                "FACEBOOK_APP_SECRET",
              ),
              fb_exchange_token: token.data,
            },
            false,
          ),
        );
      const appId = this.config.getOrThrow<string>("FACEBOOK_APP_ID");
      const metadata = z
        .object({
          data: z.object({
            is_valid: z.literal(true),
            app_id: z.literal(appId),
            type: z.literal("USER"),
            expires_at: z.number().nonnegative(),
            data_access_expires_at: z.number().nonnegative().optional(),
          }),
        })
        .parse(
          await this.graph.request(
            "debug_token",
            `${appId}|${this.config.getOrThrow<string>("FACEBOOK_APP_SECRET")}`,
            { input_token: longLived.access_token },
            false,
          ),
        );
      const expiresAt = metadata.data.expires_at
        ? metadata.data.expires_at * 1000
        : longLived.expires_in
          ? Date.now() + longLived.expires_in * 1000
          : null;
      const dataAccessExpiresAt = metadata.data.data_access_expires_at
        ? metadata.data.data_access_expires_at * 1000
        : null;
      if (
        (expiresAt !== null && expiresAt <= Date.now()) ||
        (dataAccessExpiresAt !== null && dataAccessExpiresAt <= Date.now())
      )
        throw new Error("Expired");
      await this.requirePermissions(longLived.access_token);
      const connected = randomBytes(32).toString("hex");
      await this.credentials.save(connected, {
        token: longLived.access_token,
        expiresAt,
        dataAccessExpiresAt,
        createdAt: new Date().toISOString(),
      });
      return connected;
    } catch {
      throw new BadRequestException({
        code: "FACEBOOK_CONNECTION_FAILED",
        message:
          "Could not validate and securely save Facebook access. Check all five permissions, User access token configuration and server encryption settings, then reconnect.",
      });
    }
  }
  async markReconnect(id?: string) {
    this.forget(id);
    if (id && this.credentials) await this.credentials.remove(id);
  }
  async credential(id?: string): Promise<FacebookCredential> {
    if (id && /^[a-f0-9]{64}$/.test(id)) {
      const memory = this.sessions.get(id);
      if (memory?.token && memory.expires > Date.now())
        return {
          token: memory.token,
          expiresAt: memory.expires,
          createdAt: new Date().toISOString(),
        };
      const stored = this.credentials ? await this.credentials.read(id) : null;
      if (stored) {
        if (
          (stored.expiresAt !== null && stored.expiresAt <= Date.now()) ||
          (stored.dataAccessExpiresAt &&
            stored.dataAccessExpiresAt <= Date.now()) ||
          Date.parse(stored.createdAt) + 30 * 86400000 <= Date.now()
        ) {
          await this.markReconnect(id);
        } else return stored;
      }
    }
    throw new BadRequestException({
      code: "FACEBOOK_RECONNECT_REQUIRED",
      message: "Connect or reconnect Facebook to continue.",
    });
  }
  async requirePermissions(token: string): Promise<void> {
    const permissions = z
      .object({
        data: z.array(z.object({ permission: z.string(), status: z.string() })),
      })
      .parse(await this.graph.request("me/permissions", token));
    const granted = new Set(
      permissions.data
        .filter((p) => p.status === "granted")
        .map((p) => p.permission),
    );
    if (!READ_PERMISSIONS.every((p) => granted.has(p)))
      throw new BadRequestException({
        code: "FACEBOOK_PERMISSIONS_REQUIRED",
        message:
          "Reconnect Facebook and grant all five required read permissions.",
      });
  }
  async listPages(id?: string) {
    const connection = await this.credential(id);
    try {
      await this.requirePermissions(connection.token);
      const schema = z.object({
        data: z.array(
          z.object({
            id: z.string().regex(/^\d+$/),
            name: z.string().max(1024),
          }),
        ),
        paging: z
          .object({
            next: z.string().optional(),
            cursors: z.object({ after: z.string().optional() }).optional(),
          })
          .optional(),
      });
      const pages: { id: string; name: string }[] = [];
      let after: string | undefined;
      let truncated = false;
      for (let batch = 0; batch < 5; batch++) {
        const response = schema.parse(
          await this.graph.request("me/accounts", connection.token, {
            fields: "id,name",
            limit: "25",
            ...(after ? { after } : {}),
          }),
        );
        pages.push(...response.data.slice(0, 25));
        truncated = Boolean(response.paging?.next) || response.data.length > 25;
        after = response.paging?.cursors?.after;
        if (!truncated || !after) break;
      }
      return {
        pages,
        truncated,
        expiresAt: connection.expiresAt,
        dataAccessExpiresAt: connection.dataAccessExpiresAt ?? null,
      };
    } catch (error) {
      if (error instanceof FacebookError && error.providerCode === 190) {
        await this.markReconnect(id);
        throw new BadRequestException({
          code: "FACEBOOK_RECONNECT_REQUIRED",
          message:
            "Facebook access expired or was revoked. Reconnect Facebook.",
        });
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        "Unable to list Facebook Pages. Try again or reconnect.",
      );
    }
  }
  async diagnose(id?: string) {
    const connection = await this.credential(id);
    try {
      return await this.inspectToken(connection.token);
    } catch (error) {
      if (error instanceof BadRequestException) {
        const details = error.getResponse();
        if (
          typeof details === "object" &&
          details !== null &&
          "providerCode" in details &&
          details.providerCode === 190
        ) {
          await this.markReconnect(id);
          throw new BadRequestException({
            code: "FACEBOOK_RECONNECT_REQUIRED",
            message:
              "Facebook access expired or was revoked. Reconnect Facebook.",
          });
        }
      }
      throw error;
    }
  }
  async inspectToken(token: string) {
    const permissionsSchema = z.object({
      data: z.array(z.object({ permission: z.string(), status: z.string() })),
    });
    let permissions: z.infer<typeof permissionsSchema>["data"];
    try {
      permissions = permissionsSchema.parse(
        await this.graph.request("me/permissions", token),
      ).data;
    } catch (error) {
      const providerCode =
        error instanceof FacebookError ? error.providerCode : undefined;
      const providerSubcode =
        error instanceof FacebookError ? error.providerSubcode : undefined;
      throw new BadRequestException({
        code: "FACEBOOK_TOKEN_CHECK_FAILED",
        providerCode,
        providerSubcode,
        message: `Cannot read token permissions${providerCode ? ` (Meta ${providerCode}${providerSubcode ? `/${providerSubcode}` : ""})` : ""}. Check that this is a valid user access token for this app.`,
      });
    }
    const granted = new Set(
      permissions
        .filter((p) => p.status === "granted")
        .map((p) => p.permission),
    );
    const permissionChecks = [...READ_PERMISSIONS, ...WRITE_PERMISSIONS].map(
      (permission) => ({
        permission,
        required: READ_PERMISSIONS.includes(permission),
        status:
          permissions.find((p) => p.permission === permission)?.status ??
          "not_granted",
      }),
    );
    const pageSchema = z.object({
      id: z.string().regex(/^\d+$/),
      name: z.string(),
      access_token: z.string().optional(),
      tasks: z.array(z.string()).optional(),
    });
    const listSchema = z.object({
      data: z.array(pageSchema),
      paging: z
        .object({
          next: z.string().optional(),
          cursors: z.object({ after: z.string().optional() }).optional(),
        })
        .optional(),
    });
    const pages: Record<string, unknown>[] = [];
    let after: string | undefined;
    let truncated = false;
    let pageListFailure: string | null = null;
    if (granted.has("pages_show_list")) {
      try {
        for (let batch = 0; batch < 2; batch++) {
          const list = listSchema.parse(
            await this.graph.request("me/accounts", token, {
              fields: "id,name,access_token,tasks",
              limit: "5",
              ...(after ? { after } : {}),
            }),
          );
          for (const page of list.data.slice(0, 5)) {
            const probe = async (
              path: string,
              params: Record<string, string>,
            ) => {
              if (!page.access_token)
                return { status: "unavailable", code: "NO_PAGE_TOKEN" };
              try {
                const result = await this.graph.request(
                  path,
                  page.access_token,
                  params,
                );
                // Every requested field is explicit; never return tokens or provider paging URLs.
                if (path.endsWith("/posts"))
                  return {
                    status: "available",
                    data: z
                      .object({
                        data: z.array(
                          z.object({
                            id: z.string(),
                            message: z.string().optional(),
                            created_time: z.string().optional(),
                          }),
                        ),
                      })
                      .parse(result).data,
                  };
                if (path.endsWith("/insights"))
                  return {
                    status: "available",
                    data: z
                      .object({
                        data: z.array(
                          z.object({
                            name: z.string(),
                            period: z.string(),
                            values: z.array(
                              z.object({
                                value: z.union([
                                  z.number(),
                                  z.record(z.string(), z.number()),
                                ]),
                                end_time: z.string().optional(),
                              }),
                            ),
                          }),
                        ),
                      })
                      .parse(result).data,
                  };
                return {
                  status: "available",
                  data: z
                    .object({
                      id: z.string(),
                      name: z.string().optional(),
                      followers_count: z.number().optional(),
                      fan_count: z.number().optional(),
                    })
                    .parse(result),
                };
              } catch (error) {
                return {
                  status: "unavailable",
                  code:
                    error instanceof FacebookError
                      ? error.code
                      : "INVALID_RESPONSE",
                  providerCode:
                    error instanceof FacebookError
                      ? error.providerCode
                      : undefined,
                };
              }
            };
            const [metadata, posts, insights] = await Promise.all([
              probe(page.id, { fields: "id,name,followers_count,fan_count" }),
              probe(`${page.id}/posts`, {
                fields: "id,message,created_time",
                limit: "5",
              }),
              probe(`${page.id}/insights`, {
                metric: "page_post_engagements",
                period: "day",
                since: String(Math.floor(Date.now() / 1000) - 7 * 86400),
                until: String(Math.floor(Date.now() / 1000)),
              }),
            ]);
            pages.push({
              id: page.id,
              name: page.name,
              tasks: page.tasks ?? [],
              metadata,
              posts,
              insights,
            });
          }
          truncated = Boolean(list.paging?.next) || list.data.length > 5;
          after = list.paging?.cursors?.after;
          if (!truncated || !after) break;
        }
      } catch (error) {
        pageListFailure =
          error instanceof FacebookError ? error.code : "INVALID_RESPONSE";
      }
    } else pageListFailure = "MISSING_PAGES_SHOW_LIST";
    return {
      mode: "live",
      checkedAt: new Date().toISOString(),
      permissions: permissionChecks,
      requiredPermissionsGranted: READ_PERMISSIONS.every((p) => granted.has(p)),
      pages,
      pageListFailure,
      truncated,
      writesEnabled: false,
      notice:
        "Read-only local diagnostic. Granted permissions do not establish metric availability or write capability. Insight probe tests page_post_engagements only; unavailable metrics are not zero. Up to 10 Pages and 5 recent posts per Page. OAuth connections use encrypted server storage; reconnect when Meta access or the 30-day local browser connection expires.",
    };
  }
}
