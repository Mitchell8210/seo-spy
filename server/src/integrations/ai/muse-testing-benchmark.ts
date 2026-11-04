export interface MuseTestingBenchmarkRow {
  cacheHit: boolean;
  attemptId: string | null;
  assessmentId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  estimatedTokenMicros: number | null;
  ledgerChargeMicros: number | null;
  reservedMicros: number;
  persisted: boolean;
  schemaValid: boolean | null;
  idsValid: boolean | null;
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const known = (value: number | null): value is number => value !== null;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const highest = (values: number[]) => values.length ? Math.max(...values) : null;
const distribution = (values: number[]) => ({ samples: values.length, average: mean(values), median: median(values), highest: highest(values) });

/** Pure observed-sample arithmetic. No calls, authorization, ledger writes or billing queries. */
export function benchmarkMuseTesting(rows: readonly MuseTestingBenchmarkRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of ["inputTokens", "outputTokens", "reasoningTokens", "estimatedTokenMicros", "ledgerChargeMicros", "reservedMicros"] as const) {
      const value = row[field];
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error("Benchmark values must be nonnegative integer tokens or USD micros.");
    }
    if (!row.assessmentId || !row.cacheHit && !row.attemptId) throw new Error("Every API attempt needs an assessment and unique attempt identifier.");
    if (row.reasoningTokens !== null && row.outputTokens !== null && row.reasoningTokens > row.outputTokens) throw new Error("Reasoning tokens are included in output tokens.");
    if (!row.cacheHit && row.attemptId) {
      if (seen.has(row.attemptId)) throw new Error("Duplicate API attempts would distort the benchmark.");
      seen.add(row.attemptId);
    }
  }
  const attempts = rows.filter(row => !row.cacheHit);
  const successes = attempts.filter(row => row.persisted && row.schemaValid === true && row.idsValid === true);
  const failures = attempts.filter(row => !successes.includes(row));
  const tokenCosts = attempts.map(row => row.estimatedTokenMicros).filter(known);
  const ledgerCosts = attempts.map(row => row.ledgerChargeMicros).filter(known);
  const successfulCosts = successes.map(row => row.estimatedTokenMicros).filter(known);
  const unknownTokenCosts = attempts.length - tokenCosts.length, unknownLedgerCharges = attempts.length - ledgerCosts.length;
  const distinctSuccessfulAssessments = new Set(successes.map(row => row.assessmentId)).size;
  const sufficientSample = successes.length >= 3 && distinctSuccessfulAssessments >= 2 && unknownTokenCosts === 0 && unknownLedgerCharges === 0;
  const reservationUpper = highest(attempts.map(row => row.reservedMicros));
  const observedUpper = highest([...tokenCosts, ...ledgerCosts]);
  const planningAttempt = sufficientSample ? Math.max(reservationUpper ?? 0, observedUpper ?? 0) : null;
  const planningReport = planningAttempt === null ? null : Math.ceil(planningAttempt * attempts.length / successes.length);
  return {
    provisional: true as const,
    sampleStatus: sufficientSample ? "limited-observed-sample" as const : "insufficient-for-workload-extrapolation" as const,
    counts: { attempts: attempts.length, successfulAssessments: successes.length, unsuccessfulAttempts: failures.length,
      cacheHits: rows.length - attempts.length, distinctAssessments: new Set(attempts.map(row => row.assessmentId)).size,
      distinctSuccessfulAssessments, unknownTokenCosts, unknownLedgerCharges },
    failureRate: attempts.length ? failures.length / attempts.length : null,
    estimatedTokenCosts: { knownTotalMicros: sum(tokenCosts), attempts: distribution(tokenCosts), successfulAssessments: distribution(successfulCosts),
      perCompletedReportIncludingFailuresMicros: successes.length && !unknownTokenCosts ? sum(tokenCosts) / successes.length : null,
      unsuccessfulKnownTotalMicros: sum(failures.map(row => row.estimatedTokenMicros).filter(known)) },
    ledgerAccounting: { knownTotalMicros: sum(ledgerCosts), highestAttemptMicros: highest(ledgerCosts),
      perCompletedReportIncludingFailuresMicros: successes.length && !unknownLedgerCharges ? sum(ledgerCosts) / successes.length : null,
      unsuccessfulKnownTotalMicros: sum(failures.map(row => row.ledgerChargeMicros).filter(known)) },
    tokens: { input: distribution(attempts.map(row => row.inputTokens).filter(known)), output: distribution(attempts.map(row => row.outputTokens).filter(known)),
      reasoning: distribution(attempts.map(row => row.reasoningTokens).filter(known)) },
    cacheReads: { additionalProviderTokens: 0, additionalProviderCostMicros: 0 },
    planning: { upperReservationMicrosPerAttempt: reservationUpper, scenarioMicrosPerCompletedReport: planningReport,
      reportsPerUsd: planningReport !== null && planningReport > 0 ? Math.floor(1_000_000 / planningReport) : null,
      assumptions: ["Provisional observations, not a stable workload benchmark or provider billing statement.",
        "A workload projection requires at least three validated persisted completions across two assessments and known attempt costs.",
        "The planning scenario uses the largest observed reservation or charge and the observed attempts-per-completion ratio; it is not a guaranteed statistical upper bound.",
        "No short-versus-complex comparison is established without separately labeled comparable report samples.",
        "Unknown usage is excluded from known totals and blocks aggregate token-cost projections; failed ledger charges may retain full reservations."] },
  };
}
