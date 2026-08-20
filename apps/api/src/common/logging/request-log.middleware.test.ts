import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR } from '@safra/contracts';

import { requestLogMiddleware } from './request-log.middleware.js';
import { tagResponseErrorCode } from './response-error-code.js';

/**
 * The access log.
 *
 * It began as a Nest interceptor and silently missed the traffic that matters most:
 * guards run before interceptors, so every 401 and 403 was invisible. These tests pin
 * the outcomes rather than the mechanism, so a future refactor back to an interceptor
 * fails here instead of quietly losing the rejections.
 */
describe('requestLogMiddleware', () => {
  let lines: string[];
  /** Which stream each line went to — asserted without unbinding the spied method. */
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

  /** Emits `finish` the way express does once a response is sent. */
  function run(options: {
    method: string;
    path: string;
    status: number;
    code?: string;
  }): void {
    const response = Object.assign(new EventEmitter(), {
      statusCode: options.status,
      /* Express gives every response one; the code the filter left is read from it. */
      locals: {},
    }) as unknown as Response;

    if (options.code) tagResponseErrorCode(response, options.code as never);

    const next = vi.fn();

    requestLogMiddleware(
      { method: options.method, path: options.path } as Request,
      response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    (response as unknown as EventEmitter).emit('finish');
  }

  it('records a successful request', () => {
    run({ method: 'GET', path: '/api/v1/cities', status: 200 });

    expect(lines.join('')).toMatch(/GET \/api\/v1\/cities 200 [\d.]+ms/);
  });

  /**
   * The whole reason this is middleware. A guard rejection never reaches a Nest
   * interceptor, and a 403 is exactly what an investigation looks for.
   */
  it('records a request rejected before any handler ran', () => {
    run({ method: 'GET', path: '/api/v1/admin/staff', status: 403 });

    expect(lines.join('')).toMatch(/GET \/api\/v1\/admin\/staff 403/);
  });

  it('records a route that matched nothing', () => {
    run({ method: 'GET', path: '/api/v1/no/such/route', status: 404 });

    expect(lines.join('')).toMatch(/404/);
  });

  /**
   * Level names are matched against BOTH spellings on purpose.
   *
   * These are unit tests, so Nest's default formatter is active and prints `LOG` and
   * `WARN`; the deployed app installs `JsonLogger`, which emits `"level":"info"` and
   * `"level":"warn"`. Asserting one spelling would tie the test to whichever happened
   * to be configured rather than to the behaviour being pinned.
   */
  describe('level follows the status', () => {
    it('sends 5xx to stderr', () => {
      run({ method: 'POST', path: '/api/v1/bookings', status: 500 });

      expect(streams).toContain('stderr');
    });

    /** Every rejected request at `error` would make the level meaningless. */
    it('treats 4xx as a warning, not an error', () => {
      run({ method: 'POST', path: '/api/v1/auth/login', status: 401 });

      expect(lines.join('')).toMatch(/WARN|"level":"warn"/);
      expect(streams).not.toContain('stderr');
    });

    it('treats 2xx as info', () => {
      run({ method: 'GET', path: '/api/v1/cities', status: 200 });

      expect(lines.join('')).toMatch(/LOG|INFO|"level":"info"/);
      expect(streams).toEqual(['stdout']);
    });

    /**
     * The one exception, and the reason it exists (`O-api-1`).
     *
     * A `request.capacity` 503 is the platform reporting its own load: the connection pool was
     * full, so the request was refused before it started. At `error` it is indistinguishable from
     * the 500s that must page somebody, and scenario 2 of the load test produced 1,680 of them in
     * a single run.
     */
    it('treats a capacity refusal as load rather than breakage', () => {
      run({
        method: 'POST',
        path: '/api/v1/bookings',
        status: 503,
        code: ERROR.REQUEST_CAPACITY,
      });

      expect(lines.join('')).toMatch(/WARN|"level":"warn"/);
      expect(streams).not.toContain('stderr');
    });

    /** Every OTHER 5xx is unchanged, including a 503 that names a dependency that is down. */
    it('still sends a non-capacity 503 to stderr', () => {
      run({
        method: 'POST',
        path: '/api/v1/bookings',
        status: 503,
        code: ERROR.PRICING_UNAVAILABLE,
      });

      expect(streams).toContain('stderr');
    });
  });

  /**
   * The code is what makes the line queryable. "5xx that are not `request.capacity`" is the alert
   * in `docs/alerting.md`, and deriving it from prose is how alerting rules rot.
   */
  describe('the error code', () => {
    it('is appended when the response carries one', () => {
      run({
        method: 'POST',
        path: '/api/v1/bookings',
        status: 503,
        code: ERROR.REQUEST_CAPACITY,
      });

      expect(lines.join('')).toContain(ERROR.REQUEST_CAPACITY);
    });

    it('is absent from a line that has none', () => {
      run({ method: 'GET', path: '/api/v1/cities', status: 200 });

      expect(lines.join('')).toMatch(/GET \/api\/v1\/cities 200 [\d.]+ms/);
    });

    /**
     * `res.locals` is a bag any middleware can write to, so the value is validated rather than
     * trusted — a log line is not the place to discover something else claimed the key.
     */
    it('ignores a value that is not a known code', () => {
      const response = Object.assign(new EventEmitter(), {
        statusCode: 500,
        locals: { safraErrorCode: 'not-a-real-code' },
      }) as unknown as Response;

      requestLogMiddleware(
        { method: 'GET', path: '/api/v1/cities' } as Request,
        response,
        vi.fn(),
      );
      (response as unknown as EventEmitter).emit('finish');

      expect(lines.join('')).not.toContain('not-a-real-code');
      expect(streams).toContain('stderr');
    });
  });

  describe('what must never be logged', () => {
    /**
     * `request.path` excludes the query string by construction. Asserted anyway,
     * because switching to `originalUrl` for "more detail" is an easy and quiet way
     * to start writing tokens to disk — `SANCTIONS_FEED_URL` carries one.
     */
    it('never includes a query string', () => {
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200,
      }) as unknown as Response;

      requestLogMiddleware(
        {
          method: 'GET',
          path: '/api/v1/cities',
          originalUrl: '/api/v1/cities?token=SUPER_SECRET',
        } as Request,
        response,
        vi.fn(),
      );
      (response as unknown as EventEmitter).emit('finish');

      expect(lines.join('')).not.toContain('SUPER_SECRET');
    });
  });

  describe('health probes', () => {
    /** Every few seconds per replica; they would drown everything else. */
    it('are not logged', () => {
      run({ method: 'GET', path: '/api/v1/health', status: 200 });
      run({ method: 'GET', path: '/api/v1/health/ready', status: 200 });

      expect(lines).toHaveLength(0);
    });

    it('still calls next so the probe is served', () => {
      const next = vi.fn();

      requestLogMiddleware(
        { method: 'GET', path: '/api/v1/health' } as Request,
        new EventEmitter() as unknown as Response,
        next,
      );

      expect(next).toHaveBeenCalledOnce();
    });
  });
});
