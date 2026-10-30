import { randomUUID } from "node:crypto";
import type {
  Audit,
  AuditResults,
  Business,
  Connection,
} from "../contracts/domain.js";

export const DEMO_NOTICE =
  "Simulated results only. No website scan, Facebook connection, AI call, or external action was performed.";

export function createDemoBusiness(): Business {
  return {
    id: "demo-guzman",
    name: "Guzman Tax Accounting",
    website: "https://guzmantaxaccounting.com",
    createdAt: new Date().toISOString(),
  };
}

export function createDemoConnections(business: Business): Connection[] {
  return [
    {
      id: "demo-website",
      businessId: business.id,
      platform: "website",
      identity: business.website,
      status: "connected",
      mode: "demo",
    },
    {
      id: "demo-facebook",
      businessId: business.id,
      platform: "facebook",
      identity: business.name,
      status: "connected",
      mode: "demo",
    },
  ];
}

export function createDemoResults(
  auditId: string,
  collectedAt: string,
): AuditResults {
  const samples = [
    {
      checkId: "business-hours",
      severity: "critical",
      source: "website_and_facebook",
      title: "Business hours differ across channels",
      explanation: "Sample website and Facebook hours disagree.",
      observed: { website: "Mon-Fri 9am-5pm", facebook: "Mon-Fri 9am-6pm" },
      recommendation: "Align your business hours",
      change: "Confirm the correct hours and update both channels.",
      purpose: "Help customers plan a visit.",
    },
    {
      checkId: "image-alt",
      severity: "medium",
      source: "website",
      title: "Missing image alt text",
      explanation: "A sample informational image has no text description.",
      observed: { image: "/sample-services.jpg", alt: "missing" },
      recommendation: "Add helpful image descriptions",
      change: "Describe the information conveyed by the image.",
      purpose: "Help people using screen readers understand the image.",
    },
    {
      checkId: "meta-description",
      severity: "low",
      source: "website",
      title: "Meta description needs improvement",
      explanation: "The sample homepage summary is too general.",
      observed: { description: "Welcome to our website." },
      recommendation: "Clarify your search summary",
      change:
        "Describe the tax and accounting services in the homepage description.",
      purpose: "Explain the business in search results.",
    },
  ] as const;
  const evidence = samples.map((sample) => ({
    id: randomUUID(),
    auditId,
    checkId: sample.checkId,
    sourceUrl: "https://guzmantaxaccounting.com/",
    collectedAt,
    observed: { ...sample.observed },
    mode: "demo" as const,
  }));
  const findings = samples.map((sample, index) => ({
    id: randomUUID(),
    auditId,
    checkId: sample.checkId,
    evidenceIds: [evidence[index].id],
    severity: sample.severity,
    source: sample.source,
    title: sample.title,
    explanation: sample.explanation,
    status: "needs_review" as const,
  }));
  return {
    evidence,
    findings,
    recommendations: samples.map((sample, index) => ({
      id: randomUUID(),
      auditId,
      findingId: findings[index].id,
      title: sample.recommendation,
      explanation: sample.explanation,
      recommendedChange: sample.change,
      purpose: sample.purpose,
      status: "needs_review",
    })),
    scores: [
      {
        category: "website",
        value: 78,
        maximum: 100,
        availability: "demo",
        scoringVersion: "demo-v1",
      },
      {
        category: "social",
        value: 82,
        maximum: 100,
        availability: "demo",
        scoringVersion: "demo-v1",
      },
      {
        category: "consistency",
        value: 74,
        maximum: 100,
        availability: "demo",
        scoringVersion: "demo-v1",
      },
      {
        category: "overall",
        value: 79,
        maximum: 100,
        availability: "demo",
        scoringVersion: "demo-v1",
      },
    ],
  };
}

export function createSeedAudit(businessId: string): Audit {
  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    businessId,
    mode: "demo",
    scope: "demo",
    status: "completed",
    stage: "complete",
    createdAt: now,
    startedAt: now,
    completedAt: now,
    warnings: [DEMO_NOTICE],
    failure: null,
    scoringVersion: "demo-v1",
    results: createDemoResults(id, now),
  };
}
