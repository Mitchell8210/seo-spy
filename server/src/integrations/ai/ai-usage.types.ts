export type AiLiveMode = "poc" | "demo";
export type AiModel = "muse-spark-1.3" | "muse-spark-1.2";

export interface AiUsageLimits {
  budgetMicros: number;
  dailyMicros: number;
  maxCalls: number;
}
export interface AiUsageEstimateInput {
  actor: string;
  scope: string;
  requestHash: string;
  cacheKey: string;
  mode: AiLiveMode;
  model: AiModel;
  maxInputTokens: number;
  maxOutputTokens: number;
  reserveMicros: number;
  priceVersion: string;
  inputPriceMicrosPerMillion?: number;
  outputPriceMicrosPerMillion?: number;
  reason: string;
}
export interface AiUsageIntent extends AiUsageEstimateInput {
  inputPriceMicrosPerMillion: number;
  outputPriceMicrosPerMillion: number;
  id: string;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  consumedAt: string | null;
  demoAuthorizationId: string | null;
}
export interface AiUsageAuthorization {
  actor: string;
  requestHash: string;
  mode: AiLiveMode;
  scope?: string;
  model?: AiModel;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  reserveMicros?: number;
  priceVersion?: string;
  cacheKey?: string;
  inputPriceMicrosPerMillion?: number;
  outputPriceMicrosPerMillion?: number;
}
export interface AiUsageReservation {
  id: string;
  intentId: string;
  reservedAt: string;
  reserveMicros: number;
  intent: AiUsageIntent;
}
export interface AiUsageSettlement {
  status: "success" | "failed" | "unknown";
  inputTokens?: number;
  outputTokens?: number;
  actualMicros?: number;
  requestId?: string | null;
  errorCode?: string;
}
export interface AiDemoAuthorization extends AiUsageLimits {
  id: string;
  approvedBy: string;
  approvedAt: string;
  reason?: string;
}
export interface AiUsageSummary {
  schemaVersion: "seo-spy.ai-usage.v1";
  development: AiUsageLimits & { chargedMicros: number; todayChargedMicros: number; calls: number };
  demo: { chargedMicros: number; todayChargedMicros: number; calls: number; authorization: AiDemoAuthorization | null };
  activeAttemptId: string | null;
  halted: boolean;
  lastReservedAt: string | null;
  recentAttempts: { id: string; intentId: string; mode: AiLiveMode; model: AiModel; status: string; reservedAt: string; completedAt: string | null; reserveMicros: number; chargedMicros: number; inputTokens: number | null; outputTokens: number | null; requestId: string | null; errorCode: string | null }[];
}

export class AiUsageError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "AiUsageError"; }
}
