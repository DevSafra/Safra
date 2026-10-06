import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SessionModule from '@safra/session';

/**
 * Login CSRF on the customer site's sign-in route.
 *
 * Login CSRF is the variant that needs no victim session at all: a page on another site posts the
 * ATTACKER's credentials here, the visitor's browser stores the attacker's session cookie, and the
 * bookings, favourites and payment details the visitor then enters land in an account the attacker
 * can read. The route must refuse before it authenticates anybody.
 */
const callAuth = vi.fn();

vi.mock('@safra/session', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  callAuth,
}));

const { POST } = await import('./route.js');

function signIn(headers: Record<string, string>): Request {
  return new Request('http://0.0.0.0:3000/ar/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      email: 'customer@safra.test',
      password: 'a-correct-password-1',
    }),
  });
}

describe('POST /[locale]/api/auth/login', () => {
  beforeEach(() => {
    callAuth.mockReset();
    callAuth.mockResolvedValue({
      ok: false,
      status: 401,
      code: 'auth.credentials_invalid',
    });
  });

  it('refuses a sign-in posted from another site, without authenticating', async () => {
    const response = await POST(
      signIn({ origin: 'https://evil.example', host: 'safra.example' }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'request.cross_origin' });
    expect(callAuth).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  /* The control: the guard must not refuse our own form. */
  it('still signs in from its own form', async () => {
    const response = await POST(
      signIn({ origin: 'https://safra.example', host: 'safra.example' }),
    );

    expect(callAuth).toHaveBeenCalledOnce();
    expect(response.status).toBe(401);
  });

  it('passes the unverified-address code through for the form to act on', async () => {
    callAuth.mockResolvedValue({ ok: false, status: 403, code: 'auth.email_unverified' });

    const response = await POST(
      signIn({ origin: 'https://safra.example', host: 'safra.example' }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'auth.email_unverified' });
  });
});
