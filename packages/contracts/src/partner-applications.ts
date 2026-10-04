/**
 * Whether the public «سجّل كشريك» door is open — one setting, read one way.
 *
 * Bashar, 2026-10-04: a toggle on الإعدادات that activates and deactivates the partner sign-up
 * form, and when it is off, «hide the سجل كشريك on the entire system and adding a new partner will
 * be only manual through the super admin dashboard».
 *
 * ## Two halves, and the server one is the control
 *
 * The customer site reads this to stop DRAWING the door: the header and phone-menu link, the
 * footer link, the account sidebar link, the partner sections of الرئيسية and «عن سفرة», and the
 * `/partners/join` page itself. That is a courtesy. The API reads the same key in
 * `PartnerApplicationService.submit` and refuses the request, so a replayed form, a bookmarked
 * page loaded before the switch, or a hand-built POST all meet the same closed door. The console's
 * own routes — «شريك جديد» and the onboarding flow — do not read it, which is what «manual only»
 * means.
 *
 * ## Open is the default
 *
 * Seeded `true`, and the fallback is `true`, because that is what the platform did before the
 * setting existed: a missing row or a failed read must not silently close a door nobody asked to
 * close. The API uses the same fallback (`getBoolean(…, true)`), so the two halves agree about a
 * missing row as well as a present one.
 *
 * `'false'` is honoured as well as `false`: a hand-edited `jsonb` row arrives as a string, and a
 * truthiness test on it would keep the door drawn while the API refused it.
 */
export const PARTNER_APPLICATIONS_OPEN_SETTING = 'partner.applications_open';

/** Reads the flag out of the public settings map. Takes the MAP so no caller spells the key. */
export function partnerApplicationsOpen(settings: Record<string, unknown>): boolean {
  const raw = settings[PARTNER_APPLICATIONS_OPEN_SETTING];

  return !(raw === false || raw === 'false');
}
