import { validateEnvironment } from "../src/config/environment.js";
import { readFileSync } from "node:fs";

describe("environment configuration", () => {
  it("defaults Muse off with no selected model, key or paid calls and validates budget bounds", () => {
    expect(validateEnvironment({})).toMatchObject({ AI_ENABLED: false, AI_MODEL: "", MODEL_API_KEY: "", AI_MAX_CALLS_PER_PROCESS: 0, AI_MAX_CONCURRENCY: 1 });
    for (const input of [{ AI_ENABLED: "yes" }, { AI_MODEL: "muse-spark-1.3-contributor" }, { AI_MAX_CALLS_PER_PROCESS: -1 }, { AI_MAX_CONCURRENCY: 3 }, { AI_TIMEOUT_MS: 120001 }]) expect(() => validateEnvironment(input)).toThrow("Invalid configuration:");
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    for (const line of ["MODEL_API_KEY=", "AI_MODEL=", "AI_ENABLED=false", "AI_MAX_CALLS_PER_PROCESS=0"]) expect(example.split(/\r?\n/)).toContain(line);
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
