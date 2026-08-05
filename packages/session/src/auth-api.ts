import {
  ERROR,
  isErrorCode,
  loginResponseSchema,
  type ErrorCode,
} from '@safra/contracts';

import { sessionFrom, type Session } from './session.js';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/** Matches REFRESH_COOKIE_NAME in the API. */
const API_REFRESH_COOKIE = 'safra_refresh';

export interface AuthOutcome {
  ok: boolean;
  status: number;
  session?: Session;
  /**
   * What went wrong, as a translatable code.
   *
   * The caller resolves it against the READER's locale — this package never picks a language,
   * because a route handler and middleware both use it and neither is the right place to decide.
   * `message` used to be the only field here, carrying English prose straight to the browser.
   */
  code?: ErrorCode;
  /** English text for the log. NOT for display: it is not in the reader's language. */
  message?: string;
  /** Field-keyed validation errors. Values are CODES; keys are dotted schema paths. */
  fieldErrors?: Record<string, string>;
}

/**
 * Calls an API auth endpoint and turns the result into a session.
 *
 * Shared by the route handlers and by middleware's refresh, so there is one place
 * that knows how the API answers and one place that knows how to read its cookie.
 * `Set-Cookie` parsing in particular is the sort of thing that works until someone
 * writes a second, subtly different copy of it.
 */
export async function callAuth(
  path: '/auth/login' | '/auth/register' | '/auth/refresh',
  init: { body?: unknown; refreshToken?: string; headers?: Record<string, string> },
): Promise<AuthOutcome> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.refreshToken
          ? { cookie: `${API_REFRESH_COOKIE}=${init.refreshToken}` }
          : {}),
        ...init.headers,
      },
      body: JSON.stringify(init.body ?? {}),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 502, code: ERROR.REQUEST_UPSTREAM_UNREACHABLE };
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, status: response.status, ...describeFailure(body) };
  }

  const parsed = loginResponseSchema.safeParse(body);

  if (!parsed.success) {
    return { ok: false, status: 502, code: ERROR.REQUEST_UNKNOWN };
  }

  /**
   * The rotated refresh token, or the one we sent.
   *
   * The API rotates on every use, so a refresh returns a NEW token in Set-Cookie and
   * burns the old one. Falling back to the previous value only covers the case where
   * the API chose not to rotate; keeping a spent token would end the session at the
   * next rotation and look like a random logout.
   */
  const refreshToken =
    readSetCookie(response.headers, API_REFRESH_COOKIE) ?? init.refreshToken;

  if (!refreshToken) {
    return { ok: false, status: 502, code: ERROR.AUTH_SESSION_MISSING };
  }

  return {
    ok: true,
    status: response.status,
    session: sessionFrom(parsed.data, refreshToken),
  };
}

/**
 * The client's real address and agent, forwarded to the API.
 *
 * Load-bearing on the auth routes specifically: the API rate-limits sign-in per IP,
 * and without this every customer arrives as the Next server's address — one shared
 * budget of five attempts a minute for the entire site, and an audit trail (§15)
 * that records the proxy instead of the visitor.
 */
export function forwardedHeaders(request: Request): Record<string, string> {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const userAgent = request.headers.get('user-agent');

  return {
    ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    ...(userAgent ? { 'user-agent': userAgent } : {}),
  };
}

/** Ends the session at the API, so the refresh family is revoked server-side. */
export async function callLogout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;

  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${API_REFRESH_COOKIE}=${refreshToken}` },
      cache: 'no-store',
    });
  } catch {
    /**
     * Swallowed on purpose. The local cookie is cleared regardless, so the customer
     * is signed out of this browser either way — and failing the request would leave
     * them staring at an error while still appearing logged in. The server-side
     * token expires on its own.
     */
  }
}

/**
 * Extracts one cookie's value from a response's Set-Cookie headers.
 *
 * `getSetCookie()` returns each header separately, which matters: a naive `get()`
 * joins multiple cookies with commas, and a cookie value containing a comma then
 * splits in the wrong place. Undici implements it, and Next runs on undici.
 */
export function readSetCookie(headers: Headers, name: string): string | undefined {
  const all =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie') ?? ''];

  for (const header of all) {
    const [pair] = header.split(';');
    if (!pair) continue;

    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    if (pair.slice(0, separator).trim() === name) {
      const value = pair.slice(separator + 1).trim();
      // A cleared cookie is sent as an empty value; that is a logout, not a token.
      return value.length > 0 ? value : undefined;
    }
  }

  return undefined;
}

/**
 * Turns an API error body into a code the caller can translate.
 *
 * The API answers `{ statusCode, code, message }`. Only the CODE is forwarded for display: the
 * message is English, and this runs on the way to a browser whose language is not this package's
 * business. An unrecognised code — an API newer than this build — degrades to the generic one
 * rather than being passed through as text.
 */
function describeFailure(body: unknown): {
  code: ErrorCode;
  message?: string;
  fieldErrors?: Record<string, string>;
} {
  if (typeof body !== 'object' || body === null) {
    return { code: ERROR.REQUEST_UNKNOWN };
  }

  const record = body as Record<string, unknown>;

  /**
   * `ZodValidationPipe` returns `errors: [{ field, message }]`, keyed by the dotted
   * schema path. Flattened to a map so a form can look up one input directly.
   */
  const fieldErrors: Record<string, string> = {};

  if (Array.isArray(record['errors'])) {
    for (const issue of record['errors']) {
      if (typeof issue !== 'object' || issue === null) continue;

      const { field, code } = issue as { field?: unknown; code?: unknown };

      // The CODE, not the message: this is on its way to a browser whose language is not
      // this package's business. `ZodValidationPipe` sends both.
      if (typeof field === 'string' && typeof code === 'string') {
        fieldErrors[field] = code;
      }
    }
  }

  const code = record['code'];

  return {
    code: isErrorCode(code) ? code : ERROR.REQUEST_UNKNOWN,
    ...(typeof record['message'] === 'string' ? { message: record['message'] } : {}),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
  };
}
