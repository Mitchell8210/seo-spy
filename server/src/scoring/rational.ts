import type { ExactScore } from "./scoring.types.js";
export interface Rational { n: bigint; d: bigint }
const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
export function rational(n: bigint, d = 1n): Rational {
  if (n < 0n || d <= 0n) throw new Error("Score arithmetic requires nonnegative values and positive denominators.");
  const common = gcd(n, d);
  return { n: n / common, d: d / common };
}
/** Exact decimal representation of the supplied JSON number; no floating-point weighted sum. */
export function decimal(value: number): Rational {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid score measurement.");
  const [coefficient, exponentText = "0"] = String(value).toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const exponent = Number(exponentText) - fraction.length;
  const digits = BigInt(whole + fraction);
  return exponent >= 0 ? rational(digits * 10n ** BigInt(exponent)) : rational(digits, 10n ** BigInt(-exponent));
}
export const add = (a: Rational, b: Rational): Rational => rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const multiply = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
export const exact = (value: Rational): ExactScore => ({ numerator: String(value.n), denominator: String(value.d) });
export const fromExact = (value: ExactScore): Rational => rational(BigInt(value.numerator), BigInt(value.denominator));
export const roundHalfUp = (value: Rational): number => Number((value.n * 2n + value.d) / (2n * value.d));
