import { validateEnvironment } from '../src/config/environment.js';

describe('environment configuration', () => {
  it('defaults to localhost and parses numeric values', () => {
    expect(validateEnvironment({ PORT: '3100' })).toMatchObject({ HOST: '127.0.0.1', PORT: 3100, DEMO_STAGE_DELAY_MS: 1000 });
  });

  it.each([{ PORT: 'invalid' }, { PORT: 0 }, { HOST: '0.0.0.0' }, { DEMO_STAGE_DELAY_MS: -1 }])('rejects invalid configuration %j', (input) => {
    expect(() => validateEnvironment(input)).toThrow('Invalid configuration:');
  });
});
