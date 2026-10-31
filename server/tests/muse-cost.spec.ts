import { estimateMuseCost, museUsageCostMicros, MUSE_PRICE_VALID_UNTIL, MUSE_PRICE_VERSION } from "../src/integrations/ai/muse-cost.js";

const now = Date.parse("2026-10-31T12:00:00.000Z");
const prices = { inputPriceMicrosPerMillion: 1_250_000, outputPriceMicrosPerMillion: 4_250_000 };
describe("conservative Muse USD micro reservations", () => {
  it("reserves for the full UTF-8 payload and all possible output including reasoning", () => {
    const payload = JSON.stringify({ instructions: "Español", schema: { type: "object" }, evidence: "tax" });
    const reservation = estimateMuseCost(payload, 1500, prices, now);
    expect(reservation.maxInputTokens).toBe(Buffer.byteLength(payload) * 4 + 4096);
    expect(reservation).toMatchObject({ maxOutputTokens: 1500, priceVersion: MUSE_PRICE_VERSION, ...prices });
    expect(reservation.reserveMicros).toBe(Math.ceil(reservation.maxInputTokens * 1.25) + 6375);
    expect(estimateMuseCost("x".repeat(32768), 1500, prices, now).reserveMicros).toBeLessThan(500_000);
  });
  it("rounds each charge up without floating point under-reservation", () => {
    expect(museUsageCostMicros(1, 1, prices)).toBe(7);
    expect(museUsageCostMicros(1_000_000, 1_000_000, prices)).toBe(5_500_000);
    expect(museUsageCostMicros(0, 0, prices)).toBe(0);
  });
  it("accepts higher conservative rates but rejects discounts and invalid usage", () => {
    expect(museUsageCostMicros(10, 10, { inputPriceMicrosPerMillion: 2_000_000, outputPriceMicrosPerMillion: 5_000_000 })).toBe(70);
    for (const value of [-1, NaN, 0.5, Infinity]) expect(() => museUsageCostMicros(value, 1, prices)).toThrow("pricing");
    expect(() => museUsageCostMicros(1, 1, { ...prices, inputPriceMicrosPerMillion: 1_249_999 })).toThrow("pricing");
    expect(() => museUsageCostMicros(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, prices)).toThrow("pricing");
  });
  it("fails closed when pricing expires, token/byte caps are exceeded or no payload exists", () => {
    expect(() => estimateMuseCost("x", 1500, prices, Date.parse(MUSE_PRICE_VALID_UNTIL))).toThrow("pricing");
    expect(() => estimateMuseCost("x", 1501, prices, now)).toThrow("pricing");
    expect(() => estimateMuseCost("x", 15, prices, now)).toThrow("pricing");
    expect(() => estimateMuseCost("x".repeat(32769), 1500, prices, now)).toThrow("pricing");
    expect(() => estimateMuseCost("", 1500, prices, now)).toThrow("pricing");
  });
});
