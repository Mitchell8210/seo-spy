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
  WORDPRESS_BUSINESS_ID: z.string().regex(/^[a-zA-Z0-9_-]*$/).max(128).default(""),
  WORDPRESS_SITE_URL: z.string().refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash; } catch { return false; }
  }).default(""),
  WORDPRESS_USERNAME: z.string().max(256).default(""),
  WORDPRESS_APPLICATION_PASSWORD: z.string().max(1024).default(""),
  WORDPRESS_OPERATOR_KEY: z.string().refine(value => value === "" || value.length >= 32).max(256).default(""),
  WORDPRESS_WRITES_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  WORDPRESS_ACTIONS_DIR: z.string().trim().min(1).max(4096).default("reports/wordpress-actions"),
  WORDPRESS_REPORTS_DIR: z.string().trim().min(1).max(4096).default("reports/wordpress-evidence"),
  WORDPRESS_MUSE_DIR: z.string().trim().min(1).max(4096).default("reports/wordpress-muse"),
  AI_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  MOCK_AI: z.enum(["true", "false"]).default("true").transform(value => value === "true"),
  AI_MODE: z.enum(["mock", "poc", "demo"]).default("mock"),
  AI_ADMIN_KEY: z.string().refine(value => value === "" || value.length >= 32).max(256).default(""),
  AI_ADMIN_ORIGIN: z.string().refine(value => {
    try { const url = new URL(value); return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.origin === value; } catch { return false; }
  }).default("http://localhost:5173"),
  AI_USAGE_DB: z.string().trim().min(1).max(4096).default("reports/ai-usage.sqlite"),
  MODEL_API_KEY: z.string().trim().max(1024).default(""),
  AI_MODEL: z.enum(["muse-spark-1.3", "muse-spark-1.2"]).default("muse-spark-1.3"),
  AI_PROCESSING_MODE: z.literal("standard").default("standard"),
  AI_REASONING_EFFORT: z.enum(["minimal", "low"]).default("low"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  AI_MAX_INPUT_BYTES: z.coerce.number().int().min(4096).max(32768).default(32768),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(16).max(1500).default(1500),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  AI_DEV_BUDGET_MICROS: z.coerce.number().int().min(0).max(2000000).default(2000000),
  AI_DEV_DAILY_MICROS: z.coerce.number().int().min(0).max(500000).default(500000),
  AI_DEV_MAX_CALLS: z.coerce.number().int().min(0).max(10).default(10),
  AI_INPUT_PRICE_MICROS_PER_MILLION: z.coerce.number().int().min(1250000).max(100000000).default(1250000),
  AI_OUTPUT_PRICE_MICROS_PER_MILLION: z.coerce.number().int().min(4250000).max(100000000).default(4250000),
  WORDPRESS_FRONTEND_ORIGIN: z.string().refine(value => {
    try { const url = new URL(value); return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.origin === value; } catch { return false; }
  }).default("http://localhost:5173"),
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
