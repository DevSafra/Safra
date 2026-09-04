import { permanentRedirect } from 'next/navigation';

/**
 * حسابات التحويل moved into الإعدادات (Bashar, 2026-09-04).
 *
 * The path stays and redirects rather than 404ing: a partner who bookmarked their payout accounts,
 * or was sent the link by SAFRA's support, must land where the screen now lives. `permanentRedirect`
 * because the move is permanent and a browser may cache it — the destination is a page, not an
 * action, so repeating it is harmless.
 *
 * Kept as a file rather than a `redirects()` entry in `next.config` for one reason: this note. A
 * config-level rule is invisible from the route it governs, and the next person looking for
 * حسابات التحويل will look here.
 */
export default function PayoutAccountsMoved(): never {
  permanentRedirect('/settings');
}
