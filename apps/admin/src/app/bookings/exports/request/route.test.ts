import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «تصدير CSV» builds the set on screen, not every booking (go-live audit, 2026-10-06).
 *
 * The route forwarded `q` and `status` only, so an export pressed on an alert view —
 * `?expiring=1` from EC-008, `?attention=no_check_in` from EC-011 — asked the API for every
 * booking in the operator's scope. The API half is `booking-export-filters.integration.test.ts`.
 */
vi.mock('server-only', () => ({}));
vi.mock('@/lib/session-server', () => ({
  getStaffSession: () => Promise.resolve({ accessToken: 'token' }),
}));

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));

vi.stubGlobal('fetch', fetchMock);

const { POST } = await import('./route.js');

function submit(fields: Record<string, string>): Request {
  return new Request('http://console.test/bookings/exports/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function forwarded(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];

  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('the export request', () => {
  beforeEach(() => fetchMock.mockClear());

  it.each([
    [{ expiring: '1' }],
    [{ attention: 'no_check_in' }],
    [{ q: 'دمشق', status: 'confirmed', attention: 'refund_owed' }],
  ])('forwards every filter on screen: %o', async (filters) => {
    const response = await POST(submit(filters));

    expect(response.status).toBe(303);
    expect(forwarded()).toStrictEqual(filters);
  });

  it('forwards nothing the registry does not read', async () => {
    await POST(submit({ status: 'confirmed', limit: '1000000', role: 'super_admin' }));

    expect(forwarded()).toStrictEqual({ status: 'confirmed' });
  });
});
