import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

/**
 * The boot-time refusals.
 *
 * `loadEnv` is the one place a misconfigured deploy is caught, and every check in it
 * exists because the alternative failure is silent: a mailer that logs instead of
 * sending, a simulator that marks bookings paid with no money, uploads written to a
 * disk that disappears. None of those announce themselves — they look like success
 * until someone notices much later. So the refusals are tested as behaviour.
 */
const BASE = {
  NODE_ENV: 'production',
  APP_URL: 'https://safra.example',
  ADMIN_URL: 'https://admin.safra.example',
  DATABASE_URL: 'postgres://user:pw@db.internal:5432/safra',
  REDIS_URL: 'redis://cache.internal:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  FIELD_ENCRYPTION_KEY: 'f0'.repeat(32),
  SMTP_URL: 'smtp://mail.internal:587',
  S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'e'.repeat(40),
  S3_BUCKET: 'safra-documents',
} satisfies NodeJS.ProcessEnv;

/** A production environment with one thing removed or changed. */
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...BASE, ...overrides };
}

describe('loadEnv', () => {
  it('accepts a complete production environment', () => {
    expect(() => loadEnv(env({}))).not.toThrow();
  });

  describe('refusing to boot', () => {
    it('rejects a placeholder secret left over from .env.example', () => {
      expect(() => loadEnv(env({ JWT_ACCESS_SECRET: 'replace-me' }))).toThrow();
    });

    it('rejects a secret short enough to brute-force offline', () => {
      expect(() => loadEnv(env({ JWT_REFRESH_SECRET: 'too-short' }))).toThrow();
    });

    /**
     * A gateway that marks a booking paid with no money behind it would let anyone
     * confirm a booking for free.
     */
    it('rejects the payment simulator in production', () => {
      expect(() => loadEnv(env({ PAYMENT_SIMULATOR_ENABLED: 'true' }))).toThrow(
        /simulator/i,
      );
    });

    it('rejects missing SMTP in production, where the mailer would only log', () => {
      expect(() => loadEnv(env({ SMTP_URL: undefined }))).toThrow(/SMTP_URL/);
    });

    /**
     * Regression guard. StorageModule falls back to local disk when S3 is
     * unconfigured — correct for a developer, silently destructive in production:
     * partner identity documents land on one replica's ephemeral filesystem, 404
     * from every other replica, and are lost on redeploy.
     */
    it('rejects missing S3 in production, where uploads would go to local disk', () => {
      expect(() => loadEnv(env({ S3_BUCKET: undefined }))).toThrow(/S3_BUCKET/);
      expect(() => loadEnv(env({ S3_ACCESS_KEY_ID: undefined }))).toThrow(/S3_/);
    });
  });

  describe('development stays convenient', () => {
    /**
     * The production-only checks must not fire in development, or every contributor
     * needs S3 credentials and an SMTP server to run the API locally.
     */
    it('allows no SMTP and no S3 outside production', () => {
      expect(() =>
        loadEnv(
          env({
            NODE_ENV: 'development',
            SMTP_URL: undefined,
            S3_ACCESS_KEY_ID: undefined,
            S3_BUCKET: undefined,
          }),
        ),
      ).not.toThrow();
    });
  });
});
