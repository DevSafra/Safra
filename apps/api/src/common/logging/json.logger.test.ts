import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonLogger } from './json.logger.js';
import { runWithRequestContext, setRequestUser } from './request-context.js';

/**
 * Structured logging (S-1 prerequisite).
 *
 * Two properties matter and both fail silently when broken: a secret that reaches a
 * log file is a credential in a log file, and a correlation ID that does not reach
 * every line makes the ID useless exactly when it is needed.
 */
describe('JsonLogger', () => {
  let lines: string[];
  /** Which stream each line went to, so routing can be asserted without unbinding. */
  let streams: string[];

  beforeEach(() => {
    lines = [];
    streams = [];

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      streams.push('stdout');
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      streams.push('stderr');
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const logger = () => new JsonLogger('debug', false);
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  describe('format', () => {
    it('writes one JSON object per line', () => {
      logger().log('a thing happened', 'SomeService');

      expect(parsed()[0]).toMatchObject({
        level: 'info',
        message: 'a thing happened',
        context: 'SomeService',
      });
    });

    it('sends errors and warnings to stderr, everything else to stdout', () => {
      const log = logger();
      log.error('bad');
      log.log('fine');

      expect(streams).toEqual(['stderr', 'stdout']);
    });

    it('honours the configured level instead of logging everything', () => {
      new JsonLogger('warn', false).debug('noise');
      new JsonLogger('warn', false).error('signal');

      expect(parsed()).toHaveLength(1);
      expect(parsed()[0]?.['message']).toBe('signal');
    });
  });

  describe('redaction', () => {
    /**
     * The rule this enforces is rule 1: never log secrets, tokens, passwords or full
     * PII. Enforced in the logger rather than trusted to every call site, because the
     * one time somebody logs an object that happens to contain a password is exactly
     * the time it matters.
     */
    it('replaces sensitive keys wherever they appear', () => {
      logger().log({
        email: 'someone@safra.test',
        password: 'hunter2',
        nested: { refreshToken: 'rt_secret', authorization: 'Bearer abc' },
      });

      const message = parsed()[0]?.['message'] as Record<string, unknown>;
      const nested = message['nested'] as Record<string, unknown>;

      expect(message['password']).toBe('[redacted]');
      expect(nested['refreshToken']).toBe('[redacted]');
      expect(nested['authorization']).toBe('[redacted]');
      // Not everything is a secret — an email is how a line is made useful at all.
      expect(message['email']).toBe('someone@safra.test');
    });

    it('matches sensitive keys regardless of case or underscores', () => {
      logger().log({ Password_Hash: 'x', TOTP_SECRET: 'y', apiKey: 'z' });

      const message = parsed()[0]?.['message'] as Record<string, unknown>;

      expect(Object.values(message)).toEqual(['[redacted]', '[redacted]', '[redacted]']);
    });

    it('does not leak a secret through the raw serialised line', () => {
      logger().log({ accessToken: 'eyJhbGciOiJIUzI1NiJ9.secret' });

      expect(lines[0]).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });
  });

  describe('resilience', () => {
    /** A logger that throws while logging an error destroys the error. */
    it('survives a circular structure', () => {
      const circular: Record<string, unknown> = { name: 'loop' };
      circular['self'] = circular;

      expect(() => logger().log(circular)).not.toThrow();
      expect(lines).toHaveLength(1);
    });

    it('truncates rather than walking an arbitrarily deep object', () => {
      let deep: Record<string, unknown> = { bottom: true };
      for (let i = 0; i < 20; i += 1) deep = { level: deep };

      expect(() => logger().log(deep)).not.toThrow();
      expect(lines[0]).toContain('[truncated]');
    });

    it('serialises an Error with its stack instead of as an empty object', () => {
      logger().error(new Error('it broke'));

      const message = parsed()[0]?.['message'] as Record<string, unknown>;

      expect(message['message']).toBe('it broke');
      expect(message['stack']).toContain('Error: it broke');
    });
  });

  describe('correlation', () => {
    it('stamps every line inside a request with its id', () => {
      runWithRequestContext({ requestId: 'req-abc-123' }, () => {
        logger().log('first');
        logger().log('second');
      });

      expect(parsed().map((entry) => entry['requestId'])).toEqual([
        'req-abc-123',
        'req-abc-123',
      ]);
    });

    /**
     * Authentication happens in a guard, after the middleware opened the context, so
     * the user is attached to the running context rather than starting a new one.
     */
    it('picks up the user once the guard has authenticated', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        logger().log('before auth');
        setRequestUser('user-42');
        logger().log('after auth');
      });

      expect(parsed()[0]?.['userId']).toBeUndefined();
      expect(parsed()[1]?.['userId']).toBe('user-42');
    });

    it('still logs outside a request, without an id', () => {
      logger().log('a cron job ran');

      expect(parsed()[0]).toMatchObject({ message: 'a cron job ran' });
      expect(parsed()[0]?.['requestId']).toBeUndefined();
    });

    /** Two concurrent requests must not see each other's id. */
    it('keeps concurrent requests separate', async () => {
      const log = logger();

      await Promise.all([
        runWithRequestContext({ requestId: 'req-a' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          log.log('from a');
        }),
        runWithRequestContext({ requestId: 'req-b' }, () => {
          log.log('from b');
          return Promise.resolve();
        }),
      ]);

      const byMessage = new Map(
        parsed().map((entry) => [entry['message'], entry['requestId']]),
      );

      expect(byMessage.get('from a')).toBe('req-a');
      expect(byMessage.get('from b')).toBe('req-b');
    });
  });
});
