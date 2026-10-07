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
  APP_URL: 'https://safra.sy',
  ADMIN_URL: 'https://admin.safra.sy',
  PARTNER_URL: 'https://partner.safra.sy',
  API_URL_SELF: 'https://api.safra.sy',
  MAIL_FROM: 'SAFRA <no-reply@safra.sy>',
  DATABASE_URL: 'postgres://user:pw@db.internal:5432/safra',
  REDIS_URL: 'redis://cache.internal:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  FIELD_ENCRYPTION_KEY: 'f0'.repeat(32),
  SMTP_URL: 'smtp://mail.internal:587',
  S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'e'.repeat(40),
  S3_BUCKET: 'safra-documents',
  INTERNAL_CALLER_SECRET: 'c'.repeat(48),
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

  /**
   * Without the secret the sites cannot say which visitor a call is for, so every visitor on one
   * web instance shares one rate-limit bucket — the 2026-10-06 lockout. Optional locally, where
   * that is how it has always behaved.
   */
  it('rejects a production environment without INTERNAL_CALLER_SECRET', () => {
    expect(() => loadEnv(env({ INTERNAL_CALLER_SECRET: undefined }))).toThrow(
      /INTERNAL_CALLER_SECRET/,
    );
  });

  it('rejects an INTERNAL_CALLER_SECRET short enough to guess', () => {
    expect(() => loadEnv(env({ INTERNAL_CALLER_SECRET: 'too-short' }))).toThrow(
      /INTERNAL_CALLER_SECRET/,
    );
  });

  /**
   * A partner's email linking to `http://localhost:3002`, images pointing at the API's loopback and
   * mail sent from a domain that does not exist: each looked like success and none failed a health
   * check (go-live audit, 2026-10-06). Every address a person is sent to, every way it can be wrong.
   */
  describe('refusing an address nobody outside can reach', () => {
    it.each([
      [
        'PARTNER_URL left at its localhost default',
        { PARTNER_URL: undefined },
        /PARTNER_URL/,
      ],
      [
        'API_URL_SELF left at its localhost default',
        { API_URL_SELF: undefined },
        /API_URL_SELF/,
      ],
      ['APP_URL on localhost', { APP_URL: 'https://localhost:3000' }, /APP_URL/],
      ['ADMIN_URL on loopback', { ADMIN_URL: 'https://127.0.0.1:3001' }, /ADMIN_URL/],
      [
        'PARTNER_URL on a private address',
        { PARTNER_URL: 'https://10.0.4.7' },
        /PARTNER_URL/,
      ],
      [
        'PARTNER_URL on IPv6 loopback',
        { PARTNER_URL: 'https://[::1]:3002' },
        /PARTNER_URL/,
      ],
      ['APP_URL on a reserved name', { APP_URL: 'https://safra.example' }, /APP_URL/],
      [
        'ADMIN_URL on a .test name',
        { ADMIN_URL: 'https://admin.safra.test' },
        /ADMIN_URL/,
      ],
      [
        'APP_URL over plain http',
        { APP_URL: 'http://safra.sy' },
        /APP_URL must be https/,
      ],
      [
        'S3_PUBLIC_URL on localhost',
        { S3_PUBLIC_URL: 'http://localhost:9000' },
        /S3_PUBLIC_URL/,
      ],
      ['MAIL_FROM left at its .example default', { MAIL_FROM: undefined }, /MAIL_FROM/],
      ['MAIL_FROM from example.com', { MAIL_FROM: 'ops@mail.example.com' }, /MAIL_FROM/],
      ['MAIL_FROM that is not an address', { MAIL_FROM: 'SAFRA' }, /MAIL_FROM/],
    ])('rejects %s', (_label, overrides, message) => {
      expect(() => loadEnv(env(overrides))).toThrow(message);
    });

    it('names every bad address at once', () => {
      expect(() =>
        loadEnv(env({ PARTNER_URL: undefined, MAIL_FROM: undefined })),
      ).toThrow(/PARTNER_URL[\s\S]*MAIL_FROM/);
    });

    it('accepts a bare sender address on a real domain', () => {
      expect(() => loadEnv(env({ MAIL_FROM: 'no-reply@safra.sy' }))).not.toThrow();
    });
  });

  describe('development stays convenient', () => {
    /**
     * The production-only checks must not fire in development, or every contributor
     * needs S3 credentials, an SMTP server and a public domain to run the API locally.
     */
    it('allows no SMTP, no S3 and localhost addresses outside production', () => {
      expect(() =>
        loadEnv(
          env({
            NODE_ENV: 'development',
            SMTP_URL: undefined,
            S3_ACCESS_KEY_ID: undefined,
            S3_BUCKET: undefined,
            INTERNAL_CALLER_SECRET: undefined,
            APP_URL: 'http://localhost:3000',
            PARTNER_URL: undefined,
            API_URL_SELF: undefined,
            MAIL_FROM: undefined,
          }),
        ),
      ).not.toThrow();
    });
  });
});
