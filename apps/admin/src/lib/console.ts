import { getAttention } from '@/lib/api';
import { NO_COUNTS, type SidebarCounts } from '@/components/admin-sidebar';

/**
 * Sidebar badge counts, for the sections that do not already load them.
 *
 * `/admin/attention` exists for exactly this and is three indexed counts, so it is far cheaper
 * than the full dashboard payload. Failures return an empty object rather than throwing: a missing
 * badge is a cosmetic loss, and letting it fail the page would mean a counter outage takes down
 * every screen in the console.
 *
 * This module is SERVER-ONLY by association — it imports the API client. Formatting helpers used
 * to live here too and had to move to `format.ts`, because importing one from a client component
 * pulled the server module into the browser bundle.
 */
export async function sidebarCounts(): Promise<SidebarCounts> {
  const attention = await getAttention();

  if (attention === 'failed' || attention === 'unauthenticated') return NO_COUNTS;

  return {
    bookings: attention.bookings_awaiting_confirmation,
    partners: attention.partners_pending_verification,
    properties: attention.properties_pending_review,
    partnerApplications: attention.partner_applications_open,
    disputes: attention.disputes_open,
    /*
      `NAV` declares a badge for الموظفون and NOTHING has ever produced the number — not this
      endpoint, not the dashboard. So the badge has never rendered anywhere, which is why nobody
      noticed. Left explicitly undefined rather than quietly omitted, because the required key is
      what turned "never implemented" from invisible into a line somebody has to look at. See
      `O-ui-2`; what a staff badge should even COUNT is a product question, not a missing query.
    */
    staff: undefined,
  };
}
