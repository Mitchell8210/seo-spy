import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Construct pre-upgrade records only in disposable test ledgers. The effective
 * shared policy is restored before exercising current reservation/dispatch code.
 * This is fixture setup, never a supported way to change the application budget. */
export async function withHistoricalAiPolicy<T>(path: string, limits: { budgetMicros: number; dailyMicros: number; maxCalls: number }, seed: () => Promise<T>): Promise<T> {
  if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error("Historical fixture requires a temporary ledger");
  const database = new DatabaseSync(path);
  const original = database.prepare("SELECT budget,daily,calls FROM policy WHERE id=1").get()!;
  try {
    database.prepare("UPDATE policy SET budget=?,daily=?,calls=? WHERE id=1").run(limits.budgetMicros, limits.dailyMicros, limits.maxCalls);
    database.prepare("UPDATE ai_policy_before_shared SET budget=?,daily=?,calls=?").run(limits.budgetMicros, limits.dailyMicros, limits.maxCalls);
    return await seed();
  } finally {
    // Never clear accounting halts, reservations, charges or historical records.
    database.prepare("UPDATE policy SET budget=?,daily=?,calls=? WHERE id=1").run(original.budget!, original.daily!, original.calls!);
    database.close();
  }
}

export const historicalTestingLimits = { budgetMicros: 152744, dailyMicros: 152744, maxCalls: 4 };
