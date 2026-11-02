import { benchmarkMuseTesting, type MuseTestingBenchmarkRow } from "../src/integrations/ai/muse-testing-benchmark.js";

const attempt = (id: string, changes: Partial<MuseTestingBenchmarkRow> = {}): MuseTestingBenchmarkRow => ({ cacheHit: false, attemptId: id, assessmentId: id,
  inputTokens: 100, outputTokens: 20, reasoningTokens: 10, estimatedTokenMicros: 200, ledgerChargeMicros: 200, reservedMicros: 1000,
  persisted: true, schemaValid: true, idsValid: true, ...changes });

describe("pure provisional Muse testing cost benchmark", () => {
  it("does not extrapolate from no data or one successful assessment", () => {
    expect(benchmarkMuseTesting([])).toMatchObject({ counts: { attempts: 0, successfulAssessments: 0 }, failureRate: null, planning: { scenarioMicrosPerCompletedReport: null, reportsPerUsd: null } });
    const result = benchmarkMuseTesting([attempt("a")]);
    expect(result).toMatchObject({ provisional: true, sampleStatus: "insufficient-for-workload-extrapolation", counts: { successfulAssessments: 1 }, planning: { scenarioMicrosPerCompletedReport: null, reportsPerUsd: null } });
    expect(result.estimatedTokenCosts.successfulAssessments).toEqual({ samples: 1, average: 200, median: 200, highest: 200 });
  });
  it("includes failed attempts in cost per completed report and separates conservative accounting", () => {
    const rows = [attempt("a", { estimatedTokenMicros: 100, ledgerChargeMicros: 100 }), attempt("b", { estimatedTokenMicros: 300, ledgerChargeMicros: 1000, persisted: false }),
      attempt("c", { estimatedTokenMicros: 500, ledgerChargeMicros: 500 }), attempt("d", { estimatedTokenMicros: 700, ledgerChargeMicros: 700 })];
    const result = benchmarkMuseTesting(rows);
    expect(result.counts).toMatchObject({ attempts: 4, successfulAssessments: 3, unsuccessfulAttempts: 1, distinctSuccessfulAssessments: 3 });
    expect(result.failureRate).toBe(0.25);
    expect(result.estimatedTokenCosts).toMatchObject({ knownTotalMicros: 1600, perCompletedReportIncludingFailuresMicros: 1600 / 3, unsuccessfulKnownTotalMicros: 300,
      successfulAssessments: { average: 1300 / 3, median: 500, highest: 700 } });
    expect(result.ledgerAccounting).toMatchObject({ knownTotalMicros: 2300, perCompletedReportIncludingFailuresMicros: 2300 / 3, unsuccessfulKnownTotalMicros: 1000 });
    expect(result.planning).toMatchObject({ scenarioMicrosPerCompletedReport: 1334, reportsPerUsd: 749 });
    expect(result.provisional).toBe(true);
  });
  it("keeps cache hits out of paid samples even when they refer to an earlier attempt", () => {
    const result = benchmarkMuseTesting([attempt("a"), attempt("a", { cacheHit: true }), attempt("b", { persisted: false, schemaValid: false })]);
    expect(result.counts).toMatchObject({ attempts: 2, cacheHits: 1, successfulAssessments: 1, unsuccessfulAttempts: 1 });
    expect(result.estimatedTokenCosts.knownTotalMicros).toBe(400);
    expect(result.cacheReads).toEqual({ additionalProviderTokens: 0, additionalProviderCostMicros: 0 });
  });
  it("requires schema, IDs and persistence for a successful report", () => {
    const result = benchmarkMuseTesting([attempt("a", { schemaValid: false }), attempt("b", { idsValid: null }), attempt("c", { persisted: false })]);
    expect(result.counts.successfulAssessments).toBe(0); expect(result.failureRate).toBe(1);
    expect(result.estimatedTokenCosts.perCompletedReportIncludingFailuresMicros).toBeNull();
  });
  it("makes unknown usage explicit and prevents deceptively cheap projections", () => {
    const result = benchmarkMuseTesting([attempt("a"), attempt("b"), attempt("c"), attempt("failed", { persisted: false, inputTokens: null, outputTokens: null, reasoningTokens: null, estimatedTokenMicros: null, ledgerChargeMicros: 1000 })]);
    expect(result.counts.unknownTokenCosts).toBe(1);
    expect(result.estimatedTokenCosts.knownTotalMicros).toBe(600);
    expect(result.estimatedTokenCosts.perCompletedReportIncludingFailuresMicros).toBeNull();
    expect(result.ledgerAccounting.perCompletedReportIncludingFailuresMicros).toBe(1600 / 3);
    expect(result.planning.reportsPerUsd).toBeNull();
    expect(result.tokens.reasoning.samples).toBe(3);
  });
  it("does not treat repeated tests of one assessment as a varied workload", () => {
    const result = benchmarkMuseTesting([attempt("a", { assessmentId: "same" }), attempt("b", { assessmentId: "same" }), attempt("c", { assessmentId: "same" })]);
    expect(result.counts.distinctSuccessfulAssessments).toBe(1); expect(result.planning.scenarioMicrosPerCompletedReport).toBeNull();
  });
  it("calculates medians without modifying the input and rejects duplicate or invalid measurements", () => {
    const rows = [attempt("a", { estimatedTokenMicros: 400 }), attempt("b", { estimatedTokenMicros: 100 })], original = JSON.stringify(rows);
    expect(benchmarkMuseTesting(rows).estimatedTokenCosts.attempts.median).toBe(250); expect(JSON.stringify(rows)).toBe(original);
    expect(() => benchmarkMuseTesting([attempt("a"), attempt("a")])).toThrow("Duplicate");
    expect(() => benchmarkMuseTesting([attempt("a", { outputTokens: 2, reasoningTokens: 3 })])).toThrow("included");
    expect(() => benchmarkMuseTesting([attempt("a", { estimatedTokenMicros: -1 })])).toThrow("nonnegative");
    expect(() => benchmarkMuseTesting([attempt("a", { attemptId: null })])).toThrow("unique attempt");
  });
});
