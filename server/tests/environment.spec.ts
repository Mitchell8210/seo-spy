import { validateEnvironment } from '../src/config/environment.js';
import { readFileSync } from 'node:fs';

describe('environment configuration', () => {
  it('keeps the PageSpeed key blank in the tracked environment template', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    expect(example.split(/\r?\n/).find((line) => line.startsWith('PAGESPEED_API_KEY='))).toBe('PAGESPEED_API_KEY=');
  });
  it('defaults to localhost and parses numeric values', () => {
    expect(validateEnvironment({ PORT: '3100' })).toMatchObject({ HOST: '127.0.0.1', PORT: 3100, DEMO_STAGE_DELAY_MS: 1000, PAGESPEED_API_KEY: '', PAGESPEED_TIMEOUT_MS: 120000 });
  });

  it.each([{ PORT: 'invalid' }, { PORT: 0 }, { HOST: '0.0.0.0' }, { DEMO_STAGE_DELAY_MS: -1 }, { PAGESPEED_TIMEOUT_MS: 0 }, { PAGESPEED_TIMEOUT_MS: 180001 }])('rejects invalid configuration %j', (input) => {
    expect(() => validateEnvironment(input)).toThrow('Invalid configuration:');
  });
});
