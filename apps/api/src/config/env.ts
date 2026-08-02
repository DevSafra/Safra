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

  /**
   * The fake gateway used in development and CI (ADR 0002). `loadEnv` refuses to
   * let this be true in production — a simulator that can mark bookings paid
   * without money is the single most dangerous thing in this codebase if it ever
   * reaches a live deployment, so the guard is an explicit throw rather than a
   * default.
   */
  PAYMENT_SIMULATOR_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Comma-separated so more than one is valid at a time. That is what makes
   * rotating a webhook secret safe: publish the new one, keep the old one accepted
   * until the provider has switched over, then remove it. With a single secret
   * there is always a window where live webhooks are rejected.
   */
  PAYMENT_SIMULATOR_WEBHOOK_SECRETS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),

  /**
   * Outbound email (§10.3).
   *
   * Optional, and absent means "log it instead of sending". That keeps a fresh
   * checkout runnable with no mail server — the same choice `S3_*` makes — and it is
   * why `loadEnv` refuses to let it stay absent in production: a password reset that
   * silently writes the link to a log file is an outage nobody notices until a
   * customer says they never received it.
   */
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().min(3).default('SAFRA <no-reply@safra.example>'),

  /**
   * Where the EU consolidated sanctions list is downloaded from (ADR 0002).
   *
   * No default, deliberately. The publisher's export sits behind a token it issues
   * and occasionally rotates, so a hardcoded URL would produce a system that stops
   * refreshing silently and only reveals it days later when verification starts
   * refusing on a stale list. Unset means no automatic refresh, said loudly at
   * startup, with manual import as the fallback.
   */
  SANCTIONS_FEED_URL: z.string().url().optional(),

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

  /**
   * A gateway that can mark a booking paid with no money behind it must be
   * impossible in production, not merely discouraged. Refusing to boot is the only
   * enforcement that cannot be skipped by a misconfigured deploy.
   */
  if (env.NODE_ENV === 'production' && env.PAYMENT_SIMULATOR_ENABLED) {
    throw new Error(
      'PAYMENT_SIMULATOR_ENABLED must be false in production. The payment simulator ' +
        'captures payments without money and would let anyone confirm a booking.',
    );
  }

  if (
    env.PAYMENT_SIMULATOR_ENABLED &&
    env.PAYMENT_SIMULATOR_WEBHOOK_SECRETS.length === 0
  ) {
    throw new Error(
      'PAYMENT_SIMULATOR_ENABLED is true but PAYMENT_SIMULATOR_WEBHOOK_SECRETS is empty. ' +
        'Unsigned webhooks would be accepted. Generate with: openssl rand -base64 48',
    );
  }

  const tooShort = env.PAYMENT_SIMULATOR_WEBHOOK_SECRETS.filter((s) => s.length < 32);
  if (tooShort.length > 0) {
    throw new Error(
      'Every PAYMENT_SIMULATOR_WEBHOOK_SECRETS entry must be at least 32 characters.',
    );
  }

  /**
   * Without SMTP the mailer logs instead of sending, which is right for development
   * and wrong for production in a way that hides itself: password resets and booking
   * confirmations would appear to succeed while no customer ever receives one.
   */
  if (env.NODE_ENV === 'production' && !env.SMTP_URL) {
    throw new Error(
      'SMTP_URL is required in production. Without it the mailer only logs, so ' +
        'password resets and verification emails would never be delivered.',
    );
  }

  /**
   * StorageModule falls back to local disk when S3 is unconfigured, which is correct
   * for a developer and silently destructive in production: partner identity
   * documents would be written to one replica's ephemeral filesystem, 404 from every
   * other replica behind the load balancer, and vanish on the next deploy. Losing
   * uploaded ID documents is both a compliance failure and unrecoverable, so this
   * refuses to boot rather than warn.
   */
  if (env.NODE_ENV === 'production' && !(env.S3_ACCESS_KEY_ID && env.S3_BUCKET)) {
    throw new Error(
      'S3_ACCESS_KEY_ID and S3_BUCKET are required in production. Without them ' +
        'uploads fall back to local disk, where partner identity documents are ' +
        'invisible to other replicas and lost on redeploy.',
    );
  }

  return env;
}

export const ENV = Symbol('ENV');
