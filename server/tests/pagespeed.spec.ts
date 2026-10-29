import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { PageSpeedService, PageSpeedTransport, PAGESPEED_ENDPOINT, PAGESPEED_MAX_BYTES } from '../src/integrations/lighthouse/pagespeed.service.js';
import { normalizeLighthouse } from '../src/integrations/lighthouse/normalize.js';
import { attachLighthouse } from '../src/integrations/lighthouse/evidence.js';
import { PageSpeedError } from '../src/integrations/lighthouse/types.js';
import type { AuditResults } from '../src/contracts/domain.js';
import { pageSpeedFixture } from './fixtures/pagespeed.js';

const target = 'https://www.guzmantaxaccounting.com/';

describe('Lighthouse result normalization', () => {
  it('preserves provenance, units, null outcomes, and real zero scores', () => {
    const report = normalizeLighthouse(pageSpeedFixture(), target, 'mobile');
    expect(report).toMatchObject({ provider: 'google-pagespeed-insights', strategy: 'mobile', lighthouseVersion: '13.0.0', fetchedAt: '2026-10-28T18:00:00.000Z' });
    expect(report.categories.map((category) => category.score)).toEqual([72, 91, 100, 0]);
    expect(report.categories.every((category) => category.availability === 'measured')).toBe(true);
    expect(report.metrics.find((metric) => metric.id === 'largest-contentful-paint')).toMatchObject({ value: 3200, unit: 'ms' });
    expect(report.metrics.find((metric) => metric.id === 'cumulative-layout-shift')).toMatchObject({ value: 0.02, unit: 'unitless' });
    expect(report.checks.find((check) => check.id === 'manual-check')).toMatchObject({ score: null, scoreDisplayMode: 'manual' });
  });
  it('reports missing categories and metrics as unavailable rather than zero', () => {
    const fixture = pageSpeedFixture();
    const { seo: _seo, ...categories } = fixture.lighthouseResult.categories;
    const report = normalizeLighthouse({ lighthouseResult: { ...fixture.lighthouseResult, categories, audits: {} } }, target, 'mobile');
    void _seo;
    expect(report.categories.find((category) => category.id === 'seo')).toMatchObject({ score: null, availability: 'unavailable' });
    expect(report.metrics.every((metric) => metric.value === null)).toBe(true);
    expect(report.warnings).toContain('SEO score is unavailable.');
  });
  it.each([
    {},
    { lighthouseResult: { ...pageSpeedFixture().lighthouseResult, requestedUrl: 'https://other.example/' } },
    { lighthouseResult: { ...pageSpeedFixture().lighthouseResult, finalUrl: 'http://127.0.0.1/' } },
    { lighthouseResult: { ...pageSpeedFixture().lighthouseResult, configSettings: { formFactor: 'desktop' } } },
    { lighthouseResult: { ...pageSpeedFixture().lighthouseResult, categories: { performance: { score: 97 } } } },
  ])('rejects invalid or mismatched provider data', (fixture) => {
    expect(() => normalizeLighthouse(fixture, target, 'mobile')).toThrow(PageSpeedError);
  });
  it('does not expose raw runtime-error messages', () => {
    expect(() => normalizeLighthouse({ lighthouseResult: { runtimeError: { code: 'NO_FCP', message: 'secret-provider-detail' } } }, target, 'mobile')).toThrow('Lighthouse could not finish measuring the page.');
  });
  it('links failed measured checks to evidence without treating manual/error checks as failures', () => {
    const results: AuditResults = { evidence: [], findings: [], recommendations: [], scores: [] };
    attachLighthouse(results, normalizeLighthouse(pageSpeedFixture(), target, 'mobile'), 'audit');
    expect(results.findings.map((finding) => finding.checkId)).toEqual(['lighthouse:first-contentful-paint', 'lighthouse:image-alt']);
    for (const finding of results.findings) {
      expect(finding.evidenceIds.every((id) => results.evidence.some((evidence) => evidence.id === id && evidence.auditId === 'audit'))).toBe(true);
      expect(results.recommendations.some((recommendation) => recommendation.findingId === finding.id)).toBe(true);
    }
    expect(results.evidence[0].observed.provider).toBe('google-pagespeed-insights');
  });
});

describe('PageSpeed HTTP transport', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses only the fixed endpoint, encodes the target, requests all categories, and puts the key in a header', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(pageSpeedFixture()));
    const transport = new PageSpeedTransport();
    await transport.fetch(`${target}?next=https://other.example&key=not-a-provider-key`, 'mobile', 'fixture-server-key', new AbortController().signal);
    const [url, options] = fetch.mock.calls[0]!;
    const sent = new URL(String(url));
    expect(`${sent.origin}${sent.pathname}`).toBe(PAGESPEED_ENDPOINT);
    expect(sent.searchParams.getAll('category')).toEqual(['performance', 'accessibility', 'best-practices', 'seo']);
    expect(sent.searchParams.get('url')).toBe(`${target}?next=https://other.example&key=not-a-provider-key`);
    expect(sent.searchParams.has('key')).toBe(false);
    expect(options).toMatchObject({ redirect: 'error', headers: { 'x-goog-api-key': 'fixture-server-key' } });
  });
  it.each([[429, 'PAGESPEED_QUOTA_EXCEEDED'], [403, 'PAGESPEED_ACCESS_DENIED'], [500, 'PAGESPEED_HTTP_ERROR']])('handles HTTP %s without leaking provider error text', async (status, code) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private-provider-message', { status: status as number }));
    await expect(new PageSpeedTransport().fetch(target, 'desktop', '', new AbortController().signal)).rejects.toMatchObject({ code });
  });
  it.each([
    new Response('not json', { headers: { 'content-type': 'text/html' } }),
    new Response('{bad-json', { headers: { 'content-type': 'application/json' } }),
  ])('rejects non-JSON and malformed responses', async (response) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    await expect(new PageSpeedTransport().fetch(target, 'mobile', '', new AbortController().signal)).rejects.toMatchObject({ code: 'PAGESPEED_INVALID_RESPONSE' });
  });
  it('rejects oversized declared bodies', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(PAGESPEED_MAX_BYTES + 1) } }));
    await expect(new PageSpeedTransport().fetch(target, 'mobile', '', new AbortController().signal)).rejects.toMatchObject({ code: 'PAGESPEED_RESPONSE_TOO_LARGE' });
  });
  it('limits streamed bytes even without a Content-Length', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(PAGESPEED_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }));
    await expect(new PageSpeedTransport().fetch(target, 'mobile', '', new AbortController().signal)).rejects.toMatchObject({ code: 'PAGESPEED_RESPONSE_TOO_LARGE' });
  });
});

describe('PageSpeed execution limits', () => {
  let transport: PageSpeedTransport;
  let service: PageSpeedService;
  beforeEach(() => {
    transport = new PageSpeedTransport();
    jest.spyOn(transport, 'fetch').mockResolvedValue(pageSpeedFixture());
    service = new PageSpeedService(new ConfigService({ PAGESPEED_API_KEY: '', PAGESPEED_TIMEOUT_MS: 120000 }), transport);
  });
  afterEach(() => jest.restoreAllMocks());

  it('rejects private targets before calling Google', async () => {
    await expect(service.run('http://127.0.0.1/', 'mobile')).rejects.toMatchObject({ code: 'PAGESPEED_UNAVAILABLE' });
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it('sanitizes transport errors and releases capacity', async () => {
    jest.mocked(transport.fetch).mockRejectedValueOnce(new Error('request contained private-api-key'));
    await expect(service.run(target, 'mobile')).rejects.toMatchObject({ code: 'PAGESPEED_UNAVAILABLE', message: 'PageSpeed Insights could not be reached or returned an unsupported response.' });
    await expect(service.run(target, 'mobile')).resolves.toMatchObject({ provider: 'google-pagespeed-insights' });
  });
  it('limits concurrency and supports shutdown', async () => {
    jest.mocked(transport.fetch).mockImplementationOnce((_target, _strategy, _key, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const shutdown = new AbortController();
    const pending = service.run(target, 'mobile', shutdown.signal);
    await expect(service.run(target, 'mobile')).rejects.toMatchObject({ code: 'PAGESPEED_BUSY' });
    shutdown.abort();
    await expect(pending).rejects.toMatchObject({ code: 'SERVER_STOPPING' });
    await expect(service.run(target, 'mobile')).resolves.toMatchObject({ strategy: 'mobile' });
  });
  it('enforces the configured total deadline', async () => {
    const deadline = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    jest.mocked(transport.fetch).mockImplementationOnce((_target, _strategy, _key, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const pending = service.run(target, 'mobile');
    deadline.abort();
    await expect(pending).rejects.toMatchObject({ code: 'PAGESPEED_TIMEOUT' });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(120000);
  });
});
