import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // This unauthenticated demo API intentionally listens on loopback only.
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEMO_STAGE_DELAY_MS: z.coerce.number().int().min(10).max(60000).default(1000),
  PAGESPEED_API_KEY: z.string().trim().max(512).default(''),
  PAGESPEED_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(120000),
});

export function validateEnvironment(input: Record<string, unknown>) {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Report invalid field names, never environment values or secrets.
    throw new Error(`Invalid configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return result.data;
}

export type Environment = z.infer<typeof environmentSchema>;
