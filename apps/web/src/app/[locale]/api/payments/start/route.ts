import { NextResponse } from 'next/server';
import { ERROR } from '@safra/contracts';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/** Matches the locales in routing.ts; anything else is not a SAFRA locale (§1.4). */
const LOCALES = new Set(['ar', 'en', 'de']);

/**
 * Server-side proxy for starting a payment.
 *
 * Same reasoning as the booking proxy: the API origin stays server-side and the real
 * client IP is forwarded for §15's audit trail.
 *
 * One addition that matters here — the locale is taken from the ROUTE, not from the
 * browser's Accept-Language. The API turns it into the return URL it hands the
 * payment provider, and the customer must come back to the language they were
 * shopping in rather than whatever their browser happens to prefer.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale } = await params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const userAgent = request.headers.get('user-agent');

  try {
    const response = await fetch(`${API_URL}/api/v1/payments/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': LOCALES.has(locale) ? locale : 'ar',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(userAgent ? { 'user-agent': userAgent } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
