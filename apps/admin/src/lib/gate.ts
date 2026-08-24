import 'server-only';

import {
  CONSOLE_SECTION_PERMISSIONS,
  STAFF_ASSIGNABLE_PERMISSIONS,
  canOpenSection,
  openableSections,
  type ConsoleSection,
} from '@safra/contracts';
import { sessionPermissions } from '@safra/session';

import { getStaffSession } from '@/lib/session-server';

/**
 * Which sections this staff member may open, and which sentence to show when they may not.
 *
 * ## The console showed every reader all twenty links
 *
 * Roles became rows a super admin defines on 2026-08-23, so a role carrying three capabilities is
 * now an ordinary thing to create. The navigation did not notice: it rendered all twenty sections
 * for everybody, the API refused the nineteen they could not read, and `staffFetch` reports a 403
 * as `'unauthenticated'` — deliberately, because a page cannot usefully tell 401 from 403. So the
 * screen said «انتهت الجلسة» and sent somebody to sign in again over a permission, which cannot
 * help and cannot be escaped. Every link was a trap.
 *
 * The map that fixes it was published on 2026-08-23 and had no consumer in this app until now.
 *
 * ## A hidden nav item is NOT an access control
 *
 * The sidebar stops somebody FINDING a section. It does nothing about a bookmark, a pasted link or
 * a typed URL, so every gated page needs its own branch — and that branch has to run BEFORE the
 * fetch, or the API answers 403 and the reader is told their session expired when it has not.
 *
 * The security boundary is `@RequirePermissions` on the API, which refuses on its own authority and
 * is checked per request against a VERIFIED token. This decides which SENTENCE a reader sees
 * instead of a refusal they cannot act on. The token is decoded here, not verified — a forged
 * cookie buys a misleading nav in the forger's own browser and nothing else.
 */

/**
 * `open` — they hold the capability.
 *
 * `role` — a role COULD carry it and theirs does not. The person who can change that is one
 * conversation away, and the sentence says so.
 *
 * `closed` — no assignable role may ever carry it, so asking would be pointless. Today that is
 * only `staff_role.manage`, which `STAFF_ASSIGNABLE_PERMISSIONS` withholds from every named role
 * because a role that can define roles can grant itself everything.
 *
 * Derived from `STAFF_ASSIGNABLE_PERMISSIONS` rather than listed by hand, so a capability moving
 * into or out of the assignable set changes the sentence automatically instead of leaving one
 * screen telling somebody a thing is impossible when it has just become grantable.
 */
export type SectionAccess = 'open' | 'role' | 'closed';

export async function sectionAccess(section: ConsoleSection): Promise<SectionAccess> {
  const session = await getStaffSession();
  const permissions = session ? sessionPermissions(session) : [];

  if (canOpenSection(permissions, CONSOLE_SECTION_PERMISSIONS, section)) return 'open';

  const required = CONSOLE_SECTION_PERMISSIONS[section];
  const assignable = (STAFF_ASSIGNABLE_PERMISSIONS as readonly string[]).includes(
    required,
  );

  return assignable ? 'role' : 'closed';
}

/**
 * Every section this reader can open, in the nav's own order.
 *
 * Used by the sidebar to decide what to render, and by `/` to decide where to send somebody whose
 * role does not open the dashboard. The order is load-bearing for the second: "the first section
 * they can open" is only meaningful if the order is the one they see.
 */
export async function readerSections(): Promise<string[]> {
  const session = await getStaffSession();

  return openableSections(
    session ? sessionPermissions(session) : [],
    CONSOLE_SECTION_PERMISSIONS,
  );
}

/**
 * The capabilities on this reader's token, for gating a CONTROL rather than a section.
 *
 * A section opens on one capability; what a reader may DO inside it is a separate question. The
 * console has fewer of these than the portal does, but they exist — a reader who may see الشركاء
 * and not approve one should not be offered the button.
 */
export async function readerPermissions(): Promise<string[]> {
  const session = await getStaffSession();

  return session ? sessionPermissions(session) : [];
}
