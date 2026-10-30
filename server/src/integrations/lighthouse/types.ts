export const LIGHTHOUSE_CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
] as const;
export type LighthouseCategoryId = (typeof LIGHTHOUSE_CATEGORIES)[number];
export type LighthouseStrategy = "mobile" | "desktop";

export interface LighthouseCategory {
  id: LighthouseCategoryId;
  title: string;
  score: number | null;
  availability: "measured" | "unavailable";
  auditIds: string[];
}

export interface LighthouseMetric {
  id: string;
  title: string;
  value: number | null;
  unit: "ms" | "unitless";
  displayValue: string | null;
}

export interface LighthouseCheck {
  id: string;
  title: string;
  description: string;
  score: number | null;
  scoreDisplayMode: string;
  displayValue: string | null;
  explanation: string | null;
}

export interface LighthouseReport {
  provider: "google-pagespeed-insights";
  strategy: LighthouseStrategy;
  requestedUrl: string;
  finalUrl: string;
  fetchedAt: string;
  lighthouseVersion: string;
  categories: LighthouseCategory[];
  metrics: LighthouseMetric[];
  checks: LighthouseCheck[];
  warnings: string[];
}

export const LIGHTHOUSE_NOTICE =
  "Homepage HTML checks plus Google PageSpeed Insights Lighthouse lab measurements. Results vary by device strategy and run; they do not establish field Core Web Vitals, accessibility compliance, social presence, or an overall SEO Spy score.";

export class PageSpeedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
