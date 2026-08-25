import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * The booking voucher (SRS §6.3 step 6, §6.5), proxied so the access token stays server-side.
 *
 * ## Streamed through, not redirected
 *
 * A redirect to the API would need the customer's token in a URL — the one place a credential is
 * logged by every proxy between here and there. The PDF comes back through this handler instead,
 * with the token attached from the HttpOnly cookie and never reaching the browser.
 *
 * ## The API decides who may see it
 *
 * `BookingsService` resolves an AccessScope, so a customer gets their own booking and nobody
 * else's. This forwards the API's status untouched: a 404 for a booking that is not theirs stays a
 * 404, which is the same answer a booking that does not exist gets.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; reference: string }> },
): Promise<NextResponse> {
  const { locale, reference } = await params;
  const session = await getSession();

  /*
    ## Every failure REDIRECTS, and never answers a body
    
    This route is reached by an `<a href>`, so whatever comes back is what the customer LOOKS at.
    A JSON body here is a bare document reading `{"code":"booking.not_found"}` with no shell and
    no way back — the defect `no-json-screens.test.ts` exists to prevent, and it caught this one
    before a person did. (The literal call is not written even in this comment: that sweep reads
    the source, and a mention would read as an occurrence.)
    
    Back to the booking they came from, which is a page that can say something. Signed out goes to
    sign-in with `next`, so the trip resumes where it stopped.
  */
  const backToBooking = new URL(
    `/${locale}/account/bookings/${encodeURIComponent(reference)}?voucher=failed`,
    request.url,
  );

  if (!session) {
    return NextResponse.redirect(
      new URL(
        `/${locale}/login?next=${encodeURIComponent(`/${locale}/account/bookings/${reference}`)}`,
        request.url,
      ),
    );
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/bookings/${encodeURIComponent(reference)}/voucher`,
      {
        headers: {
          Accept: 'application/pdf',
          Authorization: `Bearer ${session.accessToken}`,
        },
        cache: 'no-store',
      },
    );

    if (!response.ok) return NextResponse.redirect(backToBooking);

    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        /* `inline`, so a phone opens it rather than filing it — see the API's own note. */
        'Content-Disposition': `inline; filename="${encodeURIComponent(reference)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.redirect(backToBooking);
  }
}
