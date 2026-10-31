import { validateEnvironment } from "../src/config/environment.js";
import { readFileSync } from "node:fs";

describe("environment configuration", () => {
  it("defaults Muse to cost-free mocks and rejects settings beyond development safeguards", () => {
    expect(validateEnvironment({})).toMatchObject({ AI_ENABLED: false, MOCK_AI: true, AI_MODE: "mock", AI_MODEL: "muse-spark-1.3", AI_PROCESSING_MODE: "standard", AI_REASONING_EFFORT: "low", MODEL_API_KEY: "", AI_MAX_OUTPUT_TOKENS: 1500, AI_MAX_INPUT_BYTES: 32768, AI_MAX_CONCURRENCY: 1, AI_DEV_BUDGET_MICROS: 2000000, AI_DEV_DAILY_MICROS: 500000, AI_DEV_MAX_CALLS: 10 });
    for (const input of [{ AI_ENABLED: "yes" }, { MOCK_AI: "yes" }, { AI_MODE: "automatic" }, { AI_MODEL: "muse-spark-1.3-contributor" }, { AI_MODEL: "muse-wonder-1.0" }, { AI_PROCESSING_MODE: "contributor" }, { AI_REASONING_EFFORT: "high" }, { AI_MAX_OUTPUT_TOKENS: 1501 }, { AI_MAX_INPUT_BYTES: 32769 }, { AI_MAX_CONCURRENCY: 2 }, { AI_TIMEOUT_MS: 120001 }, { AI_DEV_BUDGET_MICROS: 2000001 }, { AI_DEV_DAILY_MICROS: 500001 }, { AI_DEV_MAX_CALLS: 11 }, { AI_INPUT_PRICE_MICROS_PER_MILLION: 1 }, { AI_ADMIN_KEY: "short" }]) expect(() => validateEnvironment(input)).toThrow("Invalid configuration:");
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    for (const line of ["MODEL_API_KEY=", "AI_ADMIN_KEY=", "AI_MODEL=muse-spark-1.3", "AI_ENABLED=false", "MOCK_AI=true", "AI_MODE=mock", "AI_MAX_OUTPUT_TOKENS=1500", "AI_DEV_BUDGET_MICROS=2000000"]) expect(example.split(/\r?\n/)).toContain(line);
  });
  it("keeps WordPress credentials blank and write triggers disabled until deliberately configured", () => {
    expect(validateEnvironment({})).toMatchObject({ WORDPRESS_WRITES_ENABLED: false, WORDPRESS_OPERATOR_KEY: "", WORDPRESS_BUSINESS_ID: "", WORDPRESS_SITE_URL: "" });
    expect(validateEnvironment({ WORDPRESS_WRITES_ENABLED: "false" }).WORDPRESS_WRITES_ENABLED).toBe(false);
    expect(validateEnvironment({ WORDPRESS_WRITES_ENABLED: "true" }).WORDPRESS_WRITES_ENABLED).toBe(true);
    for (const input of [{ WORDPRESS_WRITES_ENABLED: "yes" }, { WORDPRESS_OPERATOR_KEY: "short" }, { WORDPRESS_SITE_URL: "https://user:secret@example.com" }, { WORDPRESS_SITE_URL: "http://example.com" }, { WORDPRESS_SITE_URL: "https://example.com/?key=private" }, { WORDPRESS_FRONTEND_ORIGIN: "https://attacker.invalid" }]) expect(() => validateEnvironment(input)).toThrow("Invalid configuration:");
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    for (const name of ["WORDPRESS_USERNAME", "WORDPRESS_APPLICATION_PASSWORD", "WORDPRESS_OPERATOR_KEY"]) expect(example.split(/\r?\n/).find(line => line.startsWith(`${name}=`))).toBe(`${name}=`);
  });
  it("keeps Facebook disabled without credentials and restricts callbacks to local testing", () => {
    expect(validateEnvironment({})).toMatchObject({
      FACEBOOK_APP_ID: "",
      FACEBOOK_APP_SECRET: "",
      FACEBOOK_CONFIG_ID: "",
      FACEBOOK_ACCESS_TOKEN: "",
      FACEBOOK_REDIRECT_URI: "http://localhost:3001/api/facebook/callback",
      FACEBOOK_FRONTEND_ORIGIN: "http://localhost:5173",
    });
    for (const FACEBOOK_REDIRECT_URI of [
      "https://example.com/api/facebook/callback",
      "http://localhost:3001/other",
      "http://localhost:3001/api/facebook/callback?secret=value",
      "http://user@localhost:3001/api/facebook/callback",
    ]) {
      expect(() => validateEnvironment({ FACEBOOK_REDIRECT_URI })).toThrow(
        "Invalid configuration: FACEBOOK_REDIRECT_URI",
      );
    }
    const example = readFileSync(
      new URL("../.env.example", import.meta.url),
      "utf8",
    );
    for (const key of [
      "FACEBOOK_APP_ID",
      "FACEBOOK_APP_SECRET",
      "FACEBOOK_CONFIG_ID",
      "FACEBOOK_ACCESS_TOKEN",
    ]) {
      expect(
        example.split(/\r?\n/).find((line) => line.startsWith(`${key}=`)),
      ).toBe(`${key}=`);
    }
  });
  it("keeps the PageSpeed key blank in the tracked environment template", () => {
    const example = readFileSync(
      new URL("../.env.example", import.meta.url),
      "utf8",
    );
    expect(
      example
        .split(/\r?\n/)
        .find((line) => line.startsWith("PAGESPEED_API_KEY=")),
    ).toBe("PAGESPEED_API_KEY=");
  });
  it("limits the Facebook frontend to an exact local HTTP origin", () => {
    expect(validateEnvironment({ FACEBOOK_FRONTEND_ORIGIN: "http://localhost:5174" }).FACEBOOK_FRONTEND_ORIGIN).toBe("http://localhost:5174");
    for (const FACEBOOK_FRONTEND_ORIGIN of ["invalid", "https://example.com", "http://localhost:5173/path", "http://localhost:5173/", "http://user@localhost:5173", "http://localhost:5173?x=1"]) {
      expect(() => validateEnvironment({ FACEBOOK_FRONTEND_ORIGIN })).toThrow("FACEBOOK_FRONTEND_ORIGIN");
    }
  });
  it("defaults to localhost and parses numeric values", () => {
    expect(validateEnvironment({ PORT: "3100" })).toMatchObject({
      HOST: "127.0.0.1",
      PORT: 3100,
      DEMO_STAGE_DELAY_MS: 1000,
      PAGESPEED_API_KEY: "",
      PAGESPEED_TIMEOUT_MS: 120000,
      REPORTS_DIR: "reports/audits",
    });
  });

  it.each([
    { PORT: "invalid" },
    { PORT: 0 },
    { HOST: "0.0.0.0" },
    { DEMO_STAGE_DELAY_MS: -1 },
    { PAGESPEED_TIMEOUT_MS: 0 },
    { PAGESPEED_TIMEOUT_MS: 180001 },
    { REPORTS_DIR: " " },
  ])("rejects invalid configuration %j", (input) => {
    expect(() => validateEnvironment(input)).toThrow("Invalid configuration:");
  });
});
