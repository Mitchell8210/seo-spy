/** Conservative reservation policy, not a substitute for provider/account billing limits.
 * Verified Standard prices: https://dev.meta.ai/docs/pricing-rate-limits (2026-10-31).
 * Reasoning is included in the output cap: https://dev.meta.ai/docs/reasoning.
 */
export const MUSE_PRICE_VERSION = "meta-spark-standard-2026-10-31";
export const MUSE_PRICE_VALID_UNTIL = "2026-11-30T00:00:00.000Z";
export const MUSE_INPUT_PRICE_MICROS_PER_MILLION = 1_250_000;
export const MUSE_OUTPUT_PRICE_MICROS_PER_MILLION = 4_250_000;

export class MuseCostError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "MuseCostError"; }
}
const invalid = () => new MuseCostError("AI_PRICING_UNAVAILABLE", "Current conservative model pricing could not be established.");
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;

export interface MusePrices {
  inputPriceMicrosPerMillion: number;
  outputPriceMicrosPerMillion: number;
}
export interface MuseCostEstimate extends MusePrices {
  maxInputTokens: number;
  maxOutputTokens: number;
  reserveMicros: number;
  priceVersion: string;
}

export function museUsageCostMicros(inputTokens: number, outputTokens: number, prices: MusePrices): number {
  if (!integer(inputTokens) || !integer(outputTokens) || !integer(prices.inputPriceMicrosPerMillion) || !integer(prices.outputPriceMicrosPerMillion) || prices.inputPriceMicrosPerMillion < MUSE_INPUT_PRICE_MICROS_PER_MILLION || prices.outputPriceMicrosPerMillion < MUSE_OUTPUT_PRICE_MICROS_PER_MILLION) throw invalid();
  const million = 1_000_000n;
  const rounded = (tokens: number, price: number) => (BigInt(tokens) * BigInt(price) + million - 1n) / million;
  const cost = rounded(inputTokens, prices.inputPriceMicrosPerMillion) + rounded(outputTokens, prices.outputPriceMicrosPerMillion);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
  return Number(cost);
}

/** Reserve for the entire wire payload, schema/instructions included. The 4x-byte
 * bound plus framing allowance is intentionally far above normal tokenization.
 * It remains an application estimate; overrun usage must halt the durable ledger.
 */
export function estimateMuseCost(payload: string, maxOutputTokens: number, prices: MusePrices = {
  inputPriceMicrosPerMillion: MUSE_INPUT_PRICE_MICROS_PER_MILLION,
  outputPriceMicrosPerMillion: MUSE_OUTPUT_PRICE_MICROS_PER_MILLION,
}, now = Date.now()): MuseCostEstimate {
  if (typeof payload !== "string" || !payload || !Number.isFinite(now) || now < Date.parse("2026-10-31T00:00:00.000Z") || now >= Date.parse(MUSE_PRICE_VALID_UNTIL) || !integer(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > 1500) throw invalid();
  const bytes = Buffer.byteLength(payload);
  if (bytes > 32768) throw invalid();
  const maxInputTokens = bytes * 4 + 4096;
  return { ...prices, maxInputTokens, maxOutputTokens, reserveMicros: museUsageCostMicros(maxInputTokens, maxOutputTokens, prices), priceVersion: MUSE_PRICE_VERSION };
}
