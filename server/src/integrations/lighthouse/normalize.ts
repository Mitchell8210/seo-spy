import { z } from 'zod';
import { publicUrl } from '../website/collector.js';
import { LIGHTHOUSE_CATEGORIES, PageSpeedError, type LighthouseReport, type LighthouseStrategy } from './types.js';

const score = z.number().min(0).max(1).nullable().optional();
const check = z.object({
  title: z.string().max(2000), description: z.string().max(20000).default(''), score,
  scoreDisplayMode: z.string().max(100), displayValue: z.string().max(2000).optional(),
  explanation: z.string().max(5000).optional(), numericValue: z.number().nonnegative().optional(),
});
const schema = z.object({ lighthouseResult: z.object({
  requestedUrl: z.string().max(8192), finalUrl: z.string().max(8192),
  fetchTime: z.iso.datetime({ offset: true }), lighthouseVersion: z.string().min(1).max(100),
  runtimeError: z.object({ code: z.string() }).optional(),
  configSettings: z.object({ formFactor: z.enum(['mobile', 'desktop']).optional(), emulatedFormFactor: z.enum(['mobile', 'desktop']).optional() }),
  categories: z.record(z.string(), z.object({ score, auditRefs: z.array(z.object({ id: z.string().max(200) })).max(1000).default([]) })),
  audits: z.record(z.string().max(200), check).refine((value) => Object.keys(value).length <= 1000),
  runWarnings: z.array(z.string().max(5000)).max(100).default([]),
}) });

export function normalizeLighthouse(input: unknown, target: string, strategy: LighthouseStrategy): LighthouseReport {
  if (z.object({ lighthouseResult: z.object({ runtimeError: z.object({ code: z.string() }) }) }).safeParse(input).success) {
    throw new PageSpeedError('LIGHTHOUSE_RUNTIME_ERROR', 'Lighthouse could not finish measuring the page.');
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PageSpeedError('PAGESPEED_INVALID_RESPONSE', 'PageSpeed returned an invalid or unsupported Lighthouse response.');
  const result = parsed.data.lighthouseResult;
  if (result.runtimeError) throw new PageSpeedError('LIGHTHOUSE_RUNTIME_ERROR', 'Lighthouse could not finish measuring the page.');
  let requestedUrl: string;
  let finalUrl: string;
  try {
    requestedUrl = publicUrl(result.requestedUrl).href;
    finalUrl = publicUrl(result.finalUrl).href;
    if (requestedUrl !== publicUrl(target).href) throw new Error('Mismatched target');
  } catch { throw new PageSpeedError('PAGESPEED_INVALID_RESPONSE', 'The Lighthouse report did not match the requested public URL.'); }
  if ((result.configSettings.formFactor ?? result.configSettings.emulatedFormFactor) !== strategy) {
    throw new PageSpeedError('PAGESPEED_INVALID_RESPONSE', 'The Lighthouse report did not match the requested device strategy.');
  }
  const titles = { performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best practices', seo: 'SEO' };
  const categories = LIGHTHOUSE_CATEGORIES.map((id) => {
    const category = result.categories[id];
    const value = category?.score ?? null;
    return { id, title: titles[id], score: value === null ? null : Math.round(value * 100),
      availability: value === null ? 'unavailable' as const : 'measured' as const,
      auditIds: category?.auditRefs.map((ref) => ref.id) ?? [] };
  });
  const metrics = [
    ['first-contentful-paint', 'First Contentful Paint', 'ms'],
    ['largest-contentful-paint', 'Largest Contentful Paint', 'ms'],
    ['total-blocking-time', 'Total Blocking Time', 'ms'],
    ['cumulative-layout-shift', 'Cumulative Layout Shift', 'unitless'],
    ['speed-index', 'Speed Index', 'ms'],
  ].map(([id, title, unit]) => {
    const audit = result.audits[id];
    const usable = audit && !['error', 'notApplicable', 'manual'].includes(audit.scoreDisplayMode);
    return { id, title, unit: unit as 'ms' | 'unitless', value: usable ? audit.numericValue ?? null : null, displayValue: usable ? audit.displayValue ?? null : null };
  });
  const warnings = [...result.runWarnings];
  for (const category of categories) if (category.availability === 'unavailable') warnings.push(`${category.title} score is unavailable.`);
  for (const metric of metrics) if (metric.value === null) warnings.push(`${metric.title} lab measurement is unavailable.`);
  return { provider: 'google-pagespeed-insights', strategy, requestedUrl, finalUrl, fetchedAt: result.fetchTime,
    lighthouseVersion: result.lighthouseVersion, categories, metrics, warnings,
    checks: Object.entries(result.audits).map(([id, audit]) => ({ id, title: audit.title, description: audit.description,
      score: audit.score ?? null, scoreDisplayMode: audit.scoreDisplayMode, displayValue: audit.displayValue ?? null, explanation: audit.explanation ?? null })) };
}
