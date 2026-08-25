import { describe, expect, it } from 'vitest';

import { describeError, framesOnly, safeMessage } from './safe-error.js';

/**
 * The bound parameters of a failed query never reach a log line or a stored column (`O-sec-7`).
 *
 * ## Why the fixture is built the way drizzle builds it
 *
 * `DrizzleQueryError` sets `message`, `query` and `params` in its constructor:
 *
 * ```js
 * super(`Failed query: ${query}\nparams: ${params}`)
 * ```
 *
 * Read out of `drizzle-orm@0.45.2` on 2026-08-25, and the shape is reproduced here rather than
 * imported so this test still describes the hazard if the library changes it — a test that imported
 * the class would go green the day drizzle stopped interpolating, and the fix would then be removed
 * as dead code while the OTHER paths that still carry values kept carrying them.
 */
function drizzleFailure(query: string, params: readonly unknown[]): Error {
  const error = new Error(`Failed query: ${query}\nparams: ${params.join(',')}`);

  return Object.assign(error, { name: 'DrizzleQueryError', query, params: [...params] });
}

/** A hash and an encrypted secret — the two worst values a `users` statement can bind. */
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGVkcGFzc3dvcmQ';
const SECRET = 'v1:9f8c1a2b3d4e5f60718293a4b5c6d7e8:ZW5jcnlwdGVkdG90cHNlY3JldA==';

describe('describing a caught error', () => {
  const failure = drizzleFailure(
    'insert into "users" ("email", "password_hash", "totp_secret") values ($1, $2, $3)',
    ['someone@safra.test', HASH, SECRET],
  );

  it('withholds every bound value', () => {
    const described = describeError(failure);

    expect(described).not.toContain('someone@safra.test');
    expect(described).not.toContain(HASH);
    expect(described).not.toContain(SECRET);
  });

  /**
   * The opposite control, and this file is worth little without it.
   *
   * Every assertion above passes on a function that returns the empty string. What makes them mean
   * something is that the USEFUL half survives: an operator paged at three in the morning has to be
   * able to tell which statement failed and how many values it was given.
   */
  it('keeps the statement, and says how many values it withheld', () => {
    const described = describeError(failure);

    expect(described).toContain('insert into "users"');
    expect(described).toContain('DrizzleQueryError');
    expect(described).toContain('3 bound parameter(s), NOT logged');
  });

  it('names the SQLSTATE, which is the most useful non-personal thing there is', () => {
    const withSqlstate = Object.assign(drizzleFailure('select 1', ['x']), {
      cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    });

    expect(describeError(withSqlstate)).toContain('[23505]');
  });

  /**
   * The value can hide in the CAUSE, not only in the outermost error.
   *
   * `pg-pool` wraps once, and a wrapper's own message is often harmless while the error it wraps is
   * the one carrying the query. A describer that looked only at the top would report a clean line
   * and write the values out from the chain.
   */
  it('withholds values carried by a wrapped error too', () => {
    const wrapper = Object.assign(new Error('Query failed'), {
      cause: drizzleFailure('select * from users where email = $1', [
        'someone@safra.test',
      ]),
    });

    const described = describeError(wrapper);

    expect(described).not.toContain('someone@safra.test');
    expect(described).toContain('1 bound parameter(s), NOT logged');
  });

  it('does not hang on a cause that points at itself', () => {
    const looping: { message: string; cause?: unknown } = new Error('round');
    looping.cause = looping;

    expect(() => describeError(looping)).not.toThrow();
  });

  it('bounds the length, so one statement cannot flood a log', () => {
    const huge = describeError(drizzleFailure('x'.repeat(5_000), ['a']));

    expect(huge.length).toBeLessThan(1_000);
    expect(huge).toContain('chars)');
  });

  it('describes something that is not an Error at all', () => {
    expect(describeError('a string was thrown')).toBe('Non-Error thrown: string');
  });

  it('leaves an ordinary error readable', () => {
    expect(safeMessage(new Error('SMTP refused the message'))).toBe(
      'SMTP refused the message',
    );
  });
});

describe('the stack that goes beside it', () => {
  /**
   * `Error.prototype.stack` begins with `name: message`, so logging a stack whole puts back exactly
   * what `safeMessage` removed. This is the half of `O-sec-7` that is easiest to reintroduce,
   * because a stack looks like frames and is not.
   */
  it('drops the first line, which is the message', () => {
    const failure = drizzleFailure('select * from users where email = $1', [
      'someone@safra.test',
    ]);

    expect(failure.stack).toContain('someone@safra.test');
    expect(framesOnly(failure) ?? '').not.toContain('someone@safra.test');
  });

  it('keeps the frames, or there is no reason to log a stack', () => {
    const frames = framesOnly(new Error('boom')) ?? '';

    expect(frames).toContain('    at ');
  });

  it('answers undefined for an error with no stack', () => {
    const stackless = new Error('no stack');
    delete (stackless as { stack?: unknown }).stack;

    expect(framesOnly(stackless)).toBeUndefined();
  });
});
