import {
  aggregateFacebookDailyValues, createFacebookReportingWindow,
  type FacebookReportingWindow,
} from "../src/integrations/facebook/reporting-window.js";

const metric = "page_post_engagements";
function response(window: FacebookReportingWindow, value: unknown = 1) {
  return { data: [{ name: metric, period: "day", values: window.dayEnds.map(end_time => ({ end_time, value })) }] };
}

describe("Facebook complete 30-day reporting window", () => {
  it("excludes the current partial day and works before the UTC/Pacific date transition", () => {
    const window = createFacebookReportingWindow(new Date("2026-11-01T06:30:00Z"));
    expect(window).toMatchObject({ since: "2026-10-01T07:00:00.000Z", until: "2026-10-31T07:00:00.000Z",
      requestedDays: 30, timeZone: "America/Los_Angeles", basis: "complete-provider-days" });
    expect(window.dayEnds).toHaveLength(30);
    expect(window.dayEnds[0]).toBe("2026-10-02T07:00:00.000Z");
    expect(window.dayEnds.at(-1)).toBe(window.until);
  });

  it("resolves a 23-hour spring-forward day without losing a calendar period", () => {
    const window = createFacebookReportingWindow(new Date("2026-03-09T18:00:00Z"));
    expect(window.until).toBe("2026-03-09T07:00:00.000Z");
    expect(window.dayEnds.at(-2)).toBe("2026-03-08T08:00:00.000Z");
    expect(Date.parse(window.until) - Date.parse(window.dayEnds.at(-2)!)).toBe(23 * 3600000);
    expect(new Set(window.dayEnds).size).toBe(30);
  });

  it("resolves a 25-hour fall-back day and handles year boundaries", () => {
    const window = createFacebookReportingWindow(new Date("2026-11-02T18:00:00Z"));
    expect(window.until).toBe("2026-11-02T08:00:00.000Z");
    expect(window.dayEnds.at(-2)).toBe("2026-11-01T07:00:00.000Z");
    expect(Date.parse(window.until) - Date.parse(window.dayEnds.at(-2)!)).toBe(25 * 3600000);
    expect(createFacebookReportingWindow(new Date("2027-01-02T18:00:00Z")).since).toBe("2026-12-03T08:00:00.000Z");
    expect(() => createFacebookReportingWindow(new Date("invalid"))).toThrow();
  });
});

describe("Facebook daily aggregation coverage", () => {
  const window = createFacebookReportingWindow(new Date("2026-11-02T18:00:00Z"));

  it("sums exactly 30 completed periods and excludes extra old/current/future buckets", () => {
    const raw = response(window, 2);
    raw.data[0]!.values.unshift({ end_time: window.since, value: 999 });
    raw.data[0]!.values.push({ end_time: "2026-11-03T08:00:00Z", value: 999 });
    const result = aggregateFacebookDailyValues(raw, metric, window);
    expect(result).toMatchObject({ status: "available", total: 60,
      coverage: { complete: true, expectedDays: 30, returnedDays: 30 } });
    expect(result.points.at(-1)?.endTime).toBe(window.until);
  });

  it("returns unavailable rather than a partial total when a day is absent", () => {
    const raw = response(window);
    raw.data[0]!.values.splice(10, 1);
    const result = aggregateFacebookDailyValues(raw, metric, window);
    expect(result).toMatchObject({ status: "unavailable", total: null, failureCode: "INCOMPLETE_DAILY_COVERAGE",
      coverage: { complete: false, returnedDays: 29 } });
    expect(result.points).toHaveLength(29);
  });

  it("keeps a complete measured zero separate from missing measurements", () => {
    expect(aggregateFacebookDailyValues(response(window, 0), metric, window)).toMatchObject({ status: "available", total: 0 });
    expect(aggregateFacebookDailyValues({ data: [] }, metric, window)).toMatchObject({ status: "missing", total: null });
    expect(aggregateFacebookDailyValues({ data: [{ name: metric, period: "day", values: [] }] }, metric, window))
      .toMatchObject({ status: "missing", total: null });
  });

  it("sums LIKE only, interpreting sparse or empty valid reaction dictionaries as zero", () => {
    const raw = response(window, {});
    raw.data[0]!.values[0]!.value = { like: 4, love: 10 };
    raw.data[0]!.values[1]!.value = { love: 3 };
    expect(aggregateFacebookDailyValues(raw, metric, window, "like")).toMatchObject({ status: "available", total: 4 });
    expect(aggregateFacebookDailyValues(response(window, {}), metric, window, "like")).toMatchObject({ status: "available", total: 0 });
  });

  it("rejects duplicate timestamps including equivalent offsets and out-of-window duplicates", () => {
    const raw = response(window);
    raw.data[0]!.values.push({ end_time: "2026-11-02T00:00:00-0800", value: 1 });
    expect(aggregateFacebookDailyValues(raw, metric, window)).toMatchObject({ status: "unavailable", failureCode: "DUPLICATE_PERIODS", total: null });
    const outside = response(window);
    outside.data[0]!.values.push({ end_time: window.since, value: 1 }, { end_time: window.since, value: 1 });
    expect(aggregateFacebookDailyValues(outside, metric, window).failureCode).toBe("DUPLICATE_PERIODS");
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, "4", null, Number.MAX_SAFE_INTEGER + 1])("rejects invalid count %s", value => {
    expect(aggregateFacebookDailyValues(response(window, value), metric, window))
      .toMatchObject({ status: "unavailable", failureCode: "INVALID_RESPONSE", total: null });
  });

  it("rejects mismatched metrics, periods, malformed dates and invalid reaction shapes", () => {
    const raw = response(window);
    raw.data[0]!.name = "different";
    expect(aggregateFacebookDailyValues(raw, metric, window).failureCode).toBe("INVALID_RESPONSE");
    raw.data[0]!.name = metric;
    raw.data[0]!.period = "lifetime";
    expect(aggregateFacebookDailyValues(raw, metric, window).failureCode).toBe("INVALID_RESPONSE");
    raw.data[0]!.period = "day";
    raw.data[0]!.values.push({ end_time: "malformed", value: 2 });
    expect(aggregateFacebookDailyValues(raw, metric, window).failureCode).toBe("INVALID_RESPONSE");
    expect(aggregateFacebookDailyValues(response(window, 2), metric, window, "like").failureCode).toBe("INVALID_RESPONSE");
    expect(aggregateFacebookDailyValues(response(window, { like: -1 }), metric, window, "like").failureCode).toBe("INVALID_RESPONSE");
  });
});
