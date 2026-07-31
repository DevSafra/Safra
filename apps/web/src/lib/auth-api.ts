import { loginResponseSchema } from '@safra/contracts';

import { sessionFrom, type Session } from './session';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/** Matches REFRESH_COOKIE_NAME in the API. */
const API_REFRESH_COOKIE = 'safra_refresh';

export interface AuthOutcome {
  ok: boolean;
  status: number;
  session?: Session;
  /** Generic, already safe to show — the API does not leak detail (rule 1). */
  message?: string;
  /** Field-keyed validation errors, when the API returned any. */
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
    return {
      ok: false,
      status: 502,
      message: 'Could not reach the sign-in service. Please try again.',
    };
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, status: response.status, ...describeFailure(body) };
  }

  const parsed = loginResponseSchema.safeParse(body);

  if (!parsed.success) {
    return { ok: false, status: 502, message: 'Unexpected response from the server.' };
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
    return {
      ok: false,
      status: 502,
      message: 'The server did not return a session. Please try again.',
    };
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
 * Turns an API error body into something renderable.
 *
 * The API returns generic messages by design and keeps detail in its logs, so this
 * passes the message through rather than inventing a friendlier one — except for
 * validation errors, which are per-field and belong next to the input.
 */
function describeFailure(body: unknown): {
  message: string;
  fieldErrors?: Record<string, string>;
} {
  if (typeof body !== 'object' || body === null) {
    return { message: 'Sign-in failed. Please try again.' };
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

      const { field, message } = issue as { field?: unknown; message?: unknown };

      if (typeof field === 'string' && typeof message === 'string') {
        fieldErrors[field] = message;
      }
    }
  }

  return {
    message:
      typeof record['message'] === 'string'
        ? record['message']
        : 'Sign-in failed. Please try again.',
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
  };
}
