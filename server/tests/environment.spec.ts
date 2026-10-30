import { validateEnvironment } from "../src/config/environment.js";
import { readFileSync } from "node:fs";

describe("environment configuration", () => {
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
