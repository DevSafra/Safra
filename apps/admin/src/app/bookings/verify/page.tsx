import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { BookingVerification } from '@/components/booking-verification';
import { sidebarCounts } from '@/lib/console';
import { refuseSection } from '@/components/section-refusal';
import { BackLink } from '@/components/back-link';
import { backTarget } from '@/lib/search-params';
import { t } from '@/lib/strings';

/**
 * EC-010 tier 2 — «العميل أضاع رقم الحجز: يسترجعه بالبريد أو الهاتف بعد تحقق آمن».
 *
 * Its own route rather than a control on §9.4, because the whole point is that NOTHING about the
 * booking is on screen until the code passes. A panel on the detail page would already have
 * rendered the property, the dates and the customer's name above it.
 */
export const dynamic = 'force-dynamic';

export default async function BookingVerifyPage() {
  /* FIRST, before any fetch — see the note on the registry. */
  const refused = await refuseSection('bookings', t.nav.bookings);

  if (refused) return refused;

  const counts = await sidebarCounts();

  return (
    <ConsoleShell title={t.sections.bookingVerify.title} counts={counts}>
      <ConsolePanel>
        <BackLink target={backTarget('/bookings', {})} section={t.nav.bookings} />
        <div className="mt-4">
          <BookingVerification />
        </div>
      </ConsolePanel>
    </ConsoleShell>
  );
}
