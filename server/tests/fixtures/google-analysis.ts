export function analysisBatch() {
  const date = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const report = (dimensions: string[], metrics: string[], values: [string[], string[]][], rowCount = values.length) => ({
    dimensionHeaders: dimensions.map(name => ({ name })), metricHeaders: metrics.map(name => ({ name })),
    rows: values.map(([keys, values]) => ({ dimensionValues: keys.map(value => ({ value })), metricValues: values.map(value => ({ value })) })),
    rowCount, metadata: { timeZone: "UTC" },
  });
  return { reports: [
    report([], ["totalUsers", "sessions"], [[[], ["12", "20"]]]),
    report(["date"], ["totalUsers", "sessions"], [[[date(2)], ["9", "12"]], [[date(1)], ["9", "8"]]]),
    report(["sessionDefaultChannelGroup"], ["sessions"], [[["Organic Search"], ["12"]], [["Unassigned"], ["8"]]]),
    report(["deviceCategory"], ["totalUsers"], [[["desktop"], ["9"]], [["mobile"], ["5"]]]),
    report(["pagePath"], ["totalUsers"], [[["/"], ["10"]], [["/contact"], ["8"]]], 8),
  ] };
}

export function leadBatch() {
  const batch = analysisBatch();
  batch.reports = batch.reports.slice(0, 2);
  batch.reports[0].metricHeaders = [{ name: "eventCount" }, { name: "totalUsers" }];
  batch.reports[0].rows[0].metricValues = [{ value: "5" }, { value: "3" }];
  batch.reports[1].metricHeaders = [{ name: "eventCount" }];
  batch.reports[1].rows[0].metricValues = [{ value: "3" }];
  batch.reports[1].rows[1].metricValues = [{ value: "2" }];
  return batch;
}
