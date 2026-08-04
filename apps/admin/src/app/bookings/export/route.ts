import 'server-only';

import { getBookings } from '@/lib/api';
import { getStaffSession } from '@/lib/session-server';

/**
 * تصدير CSV for the bookings list (design handoff §8).
 *
 * ## It carries the CURRENT filters
 *
 * The query string is forwarded verbatim. An export that silently ignored the filter would be
 * worse than none: somebody reconciles the wrong set against a bank statement and has no way to
 * tell. The button on the page passes whatever is on screen.
 *
 * ## It pages rather than buffering
 *
 * Streamed through a `ReadableStream`, walking the cursor a page at a time. Buffering three
 * thousand rows into a string before responding would work today and fall over at the volume this
 * platform targets — and the failure mode would be an out-of-memory kill in the web tier, not a
 * slow download.
 *
 * A hard ceiling of 50 pages stops a malformed cursor loop from streaming forever. Hitting it
 * appends a visible truncation row rather than ending silently, because a CSV that stops early
 * without saying so is the single most dangerous artefact this console can produce.
 *
 * ## It is audit-relevant, and that is recorded as a gap
 *
 * Exporting moves data outside the console's access controls, so it SHOULD write an audit entry.
 * Doing that properly means the API owning the export rather than the BFF composing it — recorded
 * in `docs/design-gap-report.md` rather than left implicit.
 */
export const dynamic = 'force-dynamic';

/** Pages to walk before refusing to continue. 50 × 100 rows is a generous real export. */
const MAX_PAGES = 50;
const PAGE_SIZE = 100;

const COLUMNS = [
  'reference',
  'property',
  'customer',
  'check_in',
  'check_out',
  'amount',
  'currency',
  'status',
] as const;

export async function GET(request: Request): Promise<Response> {
  const session = await getStaffSession();

  if (!session) return new Response('Not signed in.', { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() || undefined;
  const status = url.searchParams.get('status')?.trim() || undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      /*
        A UTF-8 BOM. Without it Excel on Windows reads the file as the system codepage and every
        Arabic property name becomes mojibake — which is most of this file's content.
      */
      controller.enqueue(encoder.encode('\uFEFF'));
      controller.enqueue(encoder.encode(`${COLUMNS.join(',')}\n`));

      let cursor: string | undefined;
      let pages = 0;

      try {
        do {
          const page = await getBookings({ q, status, cursor, limit: PAGE_SIZE });

          if (page === 'failed' || page === 'unauthenticated') {
            controller.enqueue(
              encoder.encode('# export failed partway; do not reconcile\n'),
            );
            break;
          }

          for (const row of page.items) {
            controller.enqueue(
              encoder.encode(
                [
                  row.reference,
                  row.property,
                  row.customer,
                  row.checkIn,
                  row.checkOut,
                  row.amount,
                  row.currency,
                  row.status,
                ]
                  .map(csvCell)
                  .join(',') + '\n',
              ),
            );
          }

          cursor = page.nextCursor ?? undefined;
          pages += 1;
        } while (cursor && pages < MAX_PAGES);

        if (cursor) {
          // Truncation is STATED. A silently short CSV looks complete.
          controller.enqueue(
            encoder.encode(
              `# truncated at ${pages * PAGE_SIZE} rows; narrow the filter\n`,
            ),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="safra-bookings.csv"`,
      /* Never cached: it contains customer names and is generated per request. */
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Escapes one cell.
 *
 * Quotes anything containing a comma, a quote or a newline, per RFC 4180 — and also anything
 * starting with `=`, `+`, `-` or `@`, which spreadsheet software interprets as a FORMULA. A
 * property name beginning with `=` would otherwise execute on open, which is CSV injection and is
 * a real path from a partner-supplied string to code running on a finance officer's laptop.
 */
function csvCell(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const needsQuotes = dangerous || /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');

  return needsQuotes ? `"${dangerous ? `'${escaped}` : escaped}"` : escaped;
}
