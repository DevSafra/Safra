import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { CUSTOMER_SESSION_COOKIE } from '@safra/session';

import { getInvoice } from '@/lib/account';
import { isBookingReference } from '@/lib/booking-reference';
import { isLocale } from '@/i18n/routing';
import { renderReceiptPdf } from '@/lib/receipt-pdf';

/**
 * «تحميل PDF» — the receipt as a FILE (Bashar, 2026-08-18).
 *
 * It used to call `window.print()` and leave the customer to choose "Save as PDF" in the dialog.
 * Bashar asked for a download, so the file is now made server-side and sent as an attachment.
 *
 * ## Authorisation is the same question the page already answers
 *
 * `getInvoice` is the ownership-scoped read: somebody else's receipt is a 404, indistinguishably
 * from one that does not exist. It runs BEFORE any rendering, so a caller cannot spend a browser
 * process on a reference that is not theirs — which would be a way to make somebody else's booking
 * cost us a second of CPU, and a timing signal that it exists.
 *
 * ## The URL the renderer is given is ours, by construction
 *
 * Origin from configuration, locale from a closed set, reference shape-checked. Nothing the caller
 * sends reaches the browser's address bar, so this cannot be aimed at another host.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; reference: string }> },
) {
  const { locale, reference } = await params;

  if (!isLocale(locale)) return new NextResponse(null, { status: 404 });
  if (!isBookingReference(reference)) return new NextResponse(null, { status: 404 });

  const session = (await cookies()).get(CUSTOMER_SESSION_COOKIE);

  if (!session?.value) return new NextResponse(null, { status: 404 });

  /* The authorisation check, before any work is done on the caller's behalf. */
  const invoice = await getInvoice(reference);

  if (invoice === 'unauthenticated' || invoice === 'failed') {
    return new NextResponse(null, { status: 404 });
  }

  const origin = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000';
  const pdf = await renderReceiptPdf(
    `${origin}/${locale}/account/invoices/${encodeURIComponent(reference)}`,
    { name: CUSTOMER_SESSION_COOKIE, value: session.value },
  );

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      /* `attachment` is what makes it a download rather than a tab. The name is the reference. */
      'Content-Disposition': `attachment; filename="${reference}.pdf"`,
      /* A receipt is one person's. Never a shared cache, never a stored copy. */
      'Cache-Control': 'no-store, private',
    },
  });
}
