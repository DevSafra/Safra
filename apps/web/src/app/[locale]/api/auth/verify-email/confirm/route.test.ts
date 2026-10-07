import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The POST behind the «تأكيد البريد الإلكتروني» button — the only place the token is spent now.
 *
 * Cross-origin is refused before anything reaches the API: confirming somebody's address from
 * another site's form is a write made on their behalf, the shape `refuseCrossOrigin` exists for.
 */
const { POST } = await import('./route.js');

const TOKEN = 'b'.repeat(43);

function confirm(
  headers: Record<string, string>,
  body: unknown = { token: TOKEN },
): Request {
  return new Request('http://0.0.0.0:3000/ar/api/auth/verify-email/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /[locale]/api/auth/verify-email/confirm', () => {
  const upstream = vi.fn(() =>
    Promise.resolve(Response.json({ claimedBookings: 2 }, { status: 200 })),
  );

  beforeEach(() => {
    upstream.mockClear();
    vi.stubGlobal('fetch', upstream);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('confirms the token with the API and answers what it said', async () => {
    const response = await POST(
      confirm({ origin: 'https://safra.example', host: 'safra.example' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimedBookings: 2 });
    expect(upstream).toHaveBeenCalledOnce();

    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toMatch(/\/api\/v1\/auth\/email\/verify\/confirm$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
  });

  it('refuses a confirmation posted from another site, without calling the API', async () => {
    const response = await POST(
      confirm({ origin: 'https://evil.example', host: 'safra.example' }),
    );

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a token, without calling the API', async () => {
    const response = await POST(
      confirm(
        { origin: 'https://safra.example', host: 'safra.example' },
        { token: TOKEN, extra: 'field' },
      ),
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
