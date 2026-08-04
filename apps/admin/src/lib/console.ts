import { getAttention } from '@/lib/api';
import type { SidebarCounts } from '@/components/admin-sidebar';

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

  if (attention === 'failed' || attention === 'unauthenticated') return {};

  return {
    bookings: attention.bookings_awaiting_confirmation,
    partners: attention.partners_pending_verification,
    properties: attention.properties_pending_review,
  };
}
