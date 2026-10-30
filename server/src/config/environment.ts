import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // This unauthenticated demo API intentionally listens on loopback only.
  HOST: z.literal("127.0.0.1").default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DEMO_STAGE_DELAY_MS: z.coerce.number().int().min(10).max(60000).default(1000),
  PAGESPEED_API_KEY: z.string().trim().max(512).default(""),
  PAGESPEED_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(180000)
    .default(120000),
  REPORTS_DIR: z.string().trim().min(1).max(4096).default("reports/audits"),
  FACEBOOK_APP_ID: z.string().trim().regex(/^\d*$/).default(""),
  FACEBOOK_APP_SECRET: z.string().trim().default(""),
  FACEBOOK_ACCESS_TOKEN: z.string().trim().default(""),
  FACEBOOK_CONFIG_ID: z.string().trim().regex(/^\d*$/).default(""),
  FACEBOOK_TOKEN_KEY: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (/^[A-Za-z0-9+/]{43}=$/.test(value) &&
          Buffer.from(value, "base64").length === 32),
    )
    .default(""),
  FACEBOOK_CONNECTIONS_DIR: z
    .string()
    .trim()
    .min(1)
    .default("reports/facebook-connections"),
  FACEBOOK_FRONTEND_ORIGIN: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password && url.origin === value;
    } catch { return false; }
  }).default("http://localhost:5173"),
  FACEBOOK_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.0$/)
    .default("v26.0"),
  FACEBOOK_REDIRECT_URI: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.protocol === "http:" &&
        url.pathname === "/api/facebook/callback" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    })
    .default("http://localhost:3001/api/facebook/callback"),
});

export function validateEnvironment(input: Record<string, unknown>) {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Report invalid field names, never environment values or secrets.
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  return result.data;
}

export type Environment = z.infer<typeof environmentSchema>;
