import { z } from 'zod';

/**
 * Environment is validated ONCE at boot and the process refuses to start if
 * anything is missing or malformed.
 *
 * This is a security control, not tidiness: a JWT secret that silently reads as
 * `undefined` produces tokens signed with an empty key, and the failure is
 * invisible until someone forges one. Failing loudly at startup is the only safe
 * behaviour.
 */

/** Secrets must be long enough to resist offline brute force. */
const secretSchema = z
  .string()
  .min(
    32,
    'Secret must be at least 32 characters. Generate with: openssl rand -base64 48',
  )
  .refine(
    (v) => v !== 'replace-me',
    'Placeholder secret from .env.example is still in use.',
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  APP_URL: z.string().url(),
  ADMIN_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(200).default(20),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: secretSchema,
  JWT_REFRESH_SECRET: secretSchema,
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  /** AES-256-GCM key for TOTP seeds and partner payout details: 32 bytes as hex. */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-f]{64}$/i,
      'Must be 64 hex characters. Generate with: openssl rand -hex 32',
    ),

  /** This service's own public base URL, used to build media links. */
  API_URL_SELF: z.string().url().default('http://localhost:4000'),

  /**
   * Object storage. All optional: when unset the API falls back to local disk,
   * which keeps a fresh checkout runnable without cloud credentials.
   */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** CDN or bucket URL images are served from, if different from the endpoint. */
  S3_PUBLIC_URL: z.string().url().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = result.data;

  // The two token secrets must differ. If they match, a refresh token would
  // validate as an access token — a privilege escalation, not a style issue.
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
  }

  return env;
}

export const ENV = Symbol('ENV');
