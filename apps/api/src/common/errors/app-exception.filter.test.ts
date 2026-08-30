import {
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ERROR } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

import {
  AppExceptionFilter,
  isBodyTooLarge,
  isCapacityFailure,
} from './app-exception.filter.js';
import { notFound } from './app-error.js';
import { responseErrorCode } from '../logging/response-error-code.js';

/**
 * The filter that turns a full connection pool into an honest answer (`O-api-1`).
 *
 * Scenario 2 of the load test on 2026-08-20 answered 1,680 of 12,231 requests with a bare 500 while
 * the pool of twenty was exhausted by 200 concurrent booking transactions queueing on a row lock.
 * A 500 tells a client not to retry something that would have worked a second later, and it pages
 * whoever owns the 5xx signal in `docs/alerting.md` for load rather than for breakage.
 */

/** The parts of an Express response this filter touches, recorded rather than sent. */
function recorder() {
  const sent = {
    status: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    locals: {} as Record<string, unknown>,
    headersSent: false,
  };

  const response = {
    get headersSent() {
      return sent.headersSent;
    },
    locals: sent.locals,
    status(code: number) {
      sent.status = code;
      return response;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return response;
    },
    json(body: unknown) {
      sent.body = body;
      return response;
    },
  };

  return { sent, response };
}

function run(exception: unknown) {
  const { sent, response } = recorder();

  new AppExceptionFilter().catch(exception, {
    switchToHttp: () => ({ getResponse: () => response }),
  } as never);

  return sent;
}

describe('isCapacityFailure', () => {
  /**
   * The two strings are `pg-pool`'s own, taken from the source rather than remembered. Pinned here
   * because a reworded message in a future release must fail this test — the alternative is the
   * condition silently reverting to a 500 under exactly the load it was written for.
   */
  it('recognises a pool acquisition timeout', () => {
    expect(isCapacityFailure(new Error('timeout exceeded when trying to connect'))).toBe(
      true,
    );
  });

  it('recognises a connect timeout', () => {
    expect(
      isCapacityFailure(new Error('Connection terminated due to connection timeout')),
    ).toBe(true);
  });

  /** `pg-pool` wraps the underlying socket error, so the chain has to be walked. */
  it('looks down the cause chain', () => {
    const wrapped = new Error('Connection terminated due to connection timeout', {
      cause: new Error('read ECONNRESET'),
    });

    expect(isCapacityFailure(new Error('boom', { cause: wrapped }))).toBe(true);
  });

  it('recognises the SQLSTATEs the server raises while refusing a connection', () => {
    for (const code of ['53300', '53400', '57P03', '08001', '08004']) {
      expect(isCapacityFailure(Object.assign(new Error('nope'), { code }))).toBe(true);
    }
  });

  /**
   * The narrowness IS the safety property. A 503 with `Retry-After` instructs a client to send the
   * request again, and this API accepts non-idempotent writes — so only conditions where no
   * statement ever reached the database may qualify. Everything below is either ambiguous about
   * what happened or is breakage that must page.
   */
  it('does not treat breakage or mid-statement failures as capacity', () => {
    const notCapacity = [
      new Error('Internal server error'),
      Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
      }),
      Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      Object.assign(new Error('could not extend file: No space left on device'), {
        code: '53100',
      }),
      Object.assign(new Error('out of memory'), { code: '53200' }),
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      }),
      'a thrown string',
      undefined,
    ];

    for (const error of notCapacity) expect(isCapacityFailure(error)).toBe(false);
  });

  /** A cyclic cause must not hang the request that is already failing. */
  it('survives a cause cycle', () => {
    const a = new Error('a');
    Object.assign(a, { cause: a });

    expect(isCapacityFailure(a)).toBe(false);
  });
});

describe('isBodyTooLarge', () => {
  it('recognises body-parser’s own discriminator', () => {
    expect(
      isBodyTooLarge(Object.assign(new Error('x'), { type: 'entity.too.large' })),
    ).toBe(true);
  });

  /**
   * Matched on `type`, not on the message — the message is English prose from a dependency and
   * would change under us without any test noticing.
   */
  it('does not match on the wording alone', () => {
    expect(isBodyTooLarge(new Error('request entity too large'))).toBe(false);
  });

  it('ignores an ordinary error', () => {
    expect(isBodyTooLarge(new Error('something else'))).toBe(false);
    expect(isBodyTooLarge(null)).toBe(false);
  });
});

describe('AppExceptionFilter', () => {
  it('answers a pool timeout with 503 and a Retry-After', () => {
    const sent = run(new Error('timeout exceeded when trying to connect'));

    expect(sent.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(Number(sent.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(Number(sent.headers['Retry-After'])).toBeLessThanOrEqual(5);
  });

  it('carries a code the client can translate', () => {
    const sent = run(new Error('timeout exceeded when trying to connect'));

    expect(sent.body).toEqual({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: ERROR.REQUEST_CAPACITY,
      message: errorMessage(ERROR.REQUEST_CAPACITY, 'en'),
    });
  });

  /**
   * `Retry-After` is jittered because a fixed value synchronises every client refused in the same
   * instant into one retry, and the second wave exhausts the pool on schedule.
   */
  it('spreads Retry-After rather than sending one value', () => {
    const values = new Set(
      Array.from(
        { length: 60 },
        () =>
          run(new Error('timeout exceeded when trying to connect')).headers[
            'Retry-After'
          ],
      ),
    );

    expect(values.size).toBeGreaterThan(1);
  });

  /**
   * An oversized body is a 413 with a code, not a 500 (Bashar, 2026-08-21).
   *
   * `body-parser` throws before any guard, pipe or handler runs, so this filter is the only place
   * that can answer it. It answered 500 «حدث خطأ ما», which told the caller the platform had broken
   * when the platform had worked exactly as configured — and hid the one fact that would let them
   * fix it. Found on a 400KB signed contract against a 100kb default nobody had noticed.
   */
  it('answers an oversized body with 413 and a code', () => {
    const sent = run(
      Object.assign(new Error('request entity too large'), {
        type: 'entity.too.large',
      }),
    );

    expect(sent.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(sent.body).toMatchObject({ code: ERROR.REQUEST_BODY_TOO_LARGE });
  });

  /**
   * And it is NOT mistaken for a capacity failure.
   *
   * A capacity refusal carries `Retry-After` and means "try again shortly". Retrying an oversized
   * body cannot ever succeed, so telling the caller to is worse than saying nothing.
   */
  it('does not treat an oversized body as a capacity failure', () => {
    const sent = run(
      Object.assign(new Error('request entity too large'), {
        type: 'entity.too.large',
      }),
    );

    expect(sent.headers['Retry-After']).toBeUndefined();
  });

  /** The second half of `O-api-1`: a 500 used to carry no code at all. */
  it('gives an unexpected error the translatable request.unknown', () => {
    const sent = run(new Error('something nobody handled'));

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sent.body).toEqual({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR.REQUEST_UNKNOWN,
      message: errorMessage(ERROR.REQUEST_UNKNOWN, 'en'),
    });
  });

  /** Rule 1: the detail goes to the log, never to the client. */
  it('leaks nothing from the thrown error into the body', () => {
    const sent = run(
      new Error('select * from users where email = $1 -- bashar@example.com'),
    );

    expect(JSON.stringify(sent.body)).not.toContain('select');
    expect(JSON.stringify(sent.body)).not.toContain('example.com');
  });

  /**
   * Every deliberate refusal in this API is already built by `app-error.ts`. The filter must not
   * become a second opinion about them.
   */
  it('passes a coded HttpException through untouched', () => {
    const exception = notFound(ERROR.BOOKING_NOT_FOUND);
    const sent = run(exception);

    expect(sent.status).toBe(HttpStatus.NOT_FOUND);
    expect(sent.body).toEqual(exception.getResponse());
  });

  it('reproduces Nest’s shape for a string-bodied HttpException', () => {
    const sent = run(new HttpException('plain string body', HttpStatus.BAD_REQUEST));

    expect(sent.status).toBe(HttpStatus.BAD_REQUEST);
    expect(sent.body).toEqual({ statusCode: 400, message: 'plain string body' });
  });

  /** An object-bodied framework exception keeps whatever Nest put in it, keys and all. */
  it('leaves a framework exception’s own object body alone', () => {
    const exception = new NotFoundException();
    const sent = run(exception);

    expect(sent.status).toBe(HttpStatus.NOT_FOUND);
    expect(sent.body).toEqual(exception.getResponse());
  });

  it('does not invent a Retry-After for a refusal that is not about capacity', () => {
    expect(run(new HttpException('nope', 418)).headers['Retry-After']).toBeUndefined();
  });

  /** The access log reads this to tell load apart from breakage. */
  it('tags the response with the code it answered', () => {
    const capacity = recorder();
    new AppExceptionFilter().catch(new Error('timeout exceeded when trying to connect'), {
      switchToHttp: () => ({ getResponse: () => capacity.response }),
    } as never);

    expect(responseErrorCode(capacity.response)).toBe(ERROR.REQUEST_CAPACITY);
  });

  /**
   * The finding this filter's own security pass produced, live, on 2026-08-20.
   *
   * `DrizzleQueryError`'s message is `Failed query: <sql>\nparams: <values>` — the VALUES. A
   * failing sign-in wrote `params: someone@safra.test,1` to the log; the paths that write a user
   * row would carry the Argon2id hash and the encrypted TOTP secret. `JsonLogger` cannot catch it
   * because its redaction works on object keys and this is one flat string.
   */
  /**
   * An oversized UPLOAD says so, and says the limit (Bashar, 2026-08-30).
   *
   * `FileInterceptor`'s own `fileSize` limit rejects before any of our code runs and Nest builds
   * the refusal itself, with no `code` in it. Every client then reads a body it cannot name and
   * shows «حدث خطأ ما» — the message Bashar met replacing a dispute photograph. Our own
   * `ImageService.inspect` answers the same condition precisely; this is the case where the bytes
   * never reach it.
   */
  it('names an uncoded 413 from the upload interceptor, with the limit', () => {
    const sent = run(new PayloadTooLargeException('File too large'));

    expect(sent.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(sent.body).toMatchObject({
      code: ERROR.UPLOAD_FILE_TOO_LARGE,
      params: { maxMb: 10 },
    });

    /* And it fills the message the reader is actually shown. */
    expect(errorMessage(ERROR.UPLOAD_FILE_TOO_LARGE, 'ar', { maxMb: 10 })).not.toMatch(
      /\{\w+\}/,
    );
  });

  /**
   * A 413 somebody wrote DELIBERATELY is left alone.
   *
   * `ImageService.inspect` throws one carrying `upload.file_too_large` and its own params. Keying
   * the rewrite on the absence of a code is what stops this filter overwriting a refusal that was
   * already precise — and this is the assertion that says so.
   */
  it('leaves a coded 413 exactly as it was thrown', () => {
    const sent = run(
      new PayloadTooLargeException({
        statusCode: 413,
        code: ERROR.UPLOAD_FILE_TOO_LARGE,
        message: 'Original.',
        params: { maxMb: 4 },
      }),
    );

    expect(sent.body).toMatchObject({ message: 'Original.', params: { maxMb: 4 } });
  });

  describe('what reaches the log', () => {
    /** Shaped like `DrizzleQueryError`: a `query`, a `params` array, and both in the message. */
    function queryError(): Error {
      const error = new Error(
        'Failed query: select "email" from "users" where "email" = $1\n' +
          'params: bashar@example.com,1',
      );

      return Object.assign(error, {
        query: 'select "email" from "users" where "email" = $1',
        params: ['bashar@example.com', 1],
      });
    }

    function logged(exception: unknown): string {
      const written: string[] = [];
      const spy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((...args: unknown[]) => {
          written.push(args.map((arg) => String(arg)).join(' '));
        });

      run(exception);
      spy.mockRestore();

      return written.join(' ');
    }

    it('never writes a bound parameter', () => {
      const line = logged(queryError());

      expect(line).not.toContain('bashar@example.com');
    });

    /** The SQL is the useful half, it names no person, and it stays. */
    it('still says which statement failed', () => {
      const line = logged(queryError());

      expect(line).toContain('select "email" from "users"');
      expect(line).toContain('2 bound parameter(s), NOT logged');
    });

    /**
     * `Error.prototype.stack` starts with `name: message`, so logging the stack would put the
     * parameters straight back. The frames are what a stack is for.
     */
    it('does not smuggle the parameters back in through the stack', () => {
      const error = queryError();
      error.stack = `Error: ${error.message}\n    at somewhere (file.ts:1:1)`;

      const line = logged(error);

      expect(line).not.toContain('bashar@example.com');
      expect(line).toContain('at somewhere');
    });

    /** The SQLSTATE is the most useful thing in a database failure, and is not personal data. */
    it('keeps the driver’s error code', () => {
      const line = logged(
        new Error('wrapper', {
          cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
        }),
      );

      expect(line).toContain('40P01');
    });

    /** One error must not be able to flood a log. */
    it('truncates a very long message', () => {
      const line = logged(new Error('x'.repeat(5_000)));

      expect(line).toContain('chars)');
      expect(line.length).toBeLessThan(2_000);
    });
  });

  /**
   * A media response that fails halfway has already sent its status line. Writing a second body
   * would corrupt the first, so the only correct action is to log and stop.
   */
  it('writes nothing once the response has started', () => {
    const { sent, response } = recorder();
    sent.headersSent = true;

    new AppExceptionFilter().catch(new Error('mid-stream'), {
      switchToHttp: () => ({ getResponse: () => response }),
    } as never);

    expect(sent.status).toBe(0);
    expect(sent.body).toBeUndefined();
  });
});
