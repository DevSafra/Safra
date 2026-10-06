import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PARTNER_SESSION_COOKIE, encodeSession } from '@safra/session';
import type * as SessionModule from '@safra/session';

/**
 * Signing out of the partner portal ends the session at the API, not only in this browser.
 *
 * The route used to clear the cookie and nothing else, so the refresh token it held stayed valid
 * for its full thirty days. A partner who signed out of a shared reception computer believing they
 * were done left a token that anybody who had copied it could keep exchanging for fresh access. The
 * console and the customer site have always revoked; this was the one portal that did not.
 */
/* Hoisted: the static import of `@safra/session` above runs the mock factory before this file's body. */
const { callLogout, jar } = vi.hoisted(() => ({
  callLogout: vi.fn((_token: string | undefined, _headers?: Record<string, string>) =>
    Promise.resolve(),
  ),
  jar: { value: undefined as string | undefined },
}));

vi.mock('@safra/session', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  callLogout,
}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        jar.value !== undefined ? { name, value: jar.value } : undefined,
    }),
}));

const { POST } = await import('./route.js');

const session = {
  accessToken: 'access',
  refreshToken: 'the-partner-refresh-token',
  user: {
    id: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b',
    email: 'partner@safra.test',
    role: 'partner',
    preferredLocale: 'ar',
    permissions: [],
  },
  expiresAt: Date.now() + 60_000,
};

function signOut(): Request {
  return new Request('http://0.0.0.0:3002/api/auth/logout', { method: 'POST' });
}

describe('POST /api/auth/logout (partner portal)', () => {
  beforeEach(() => {
    callLogout.mockClear();
    jar.value = undefined;
  });

  it('revokes the refresh token at the API', async () => {
    jar.value = encodeSession(session as never);

    await POST(signOut());

    expect(callLogout.mock.calls[0]?.[0]).toBe('the-partner-refresh-token');
  });

  it('still clears the cookie and goes to sign-in', async () => {
    jar.value = encodeSession(session as never);

    const response = await POST(signOut());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('set-cookie')).toContain(`${PARTNER_SESSION_COOKIE}=;`);
  });

  /* Signed out already, or a cookie nobody can read: nothing to revoke, and still a clean exit. */
  it('signs out cleanly with no session to revoke', async () => {
    const response = await POST(signOut());

    expect(callLogout).toHaveBeenCalledOnce();
    expect(callLogout.mock.calls[0]?.[0]).toBeUndefined();
    expect(response.status).toBe(303);
  });
});
