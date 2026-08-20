/**
 * Shared plumbing for the لوحة الشريك browser tests.
 *
 * Not named `*.spec.ts` or `*.setup.ts` on purpose: Playwright collects both, and it refuses to
 * let a spec import a setup file — so the constants they share have to live somewhere that is
 * neither. `staff.ts` exists for the same reason and this mirrors it.
 */

/** Where `partner.setup.ts` writes the captured session, and the specs read it. */
export const PARTNER_STATE = 'test-results/.partner-session.json';

export const PARTNER_BASE = process.env['PARTNER_URL'] ?? 'http://localhost:3002';
export const PARTNER_EMAIL = process.env['DEV_PARTNER_EMAIL'] ?? 'partner1@safra.test';
export const PARTNER_PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

/**
 * A second fixture partner, for the tests that need two accounts at once.
 *
 * It used to be `UNENROLLED_PARTNER_EMAIL` — the account `db:testbed` deliberately left without an
 * authenticator, so the suite could prove that an existing partner was FORCED into enrolment on
 * their next sign-in. That requirement ended on 2026-08-20: a partner's second factor is a code
 * emailed at every sign-in and there is nothing to enrol, so no partner is held anywhere and the
 * fixture has no special property left. The name went with the behaviour.
 */
export const SECOND_PARTNER_EMAIL = 'partner3@safra.test';

/**
 * A third fixture partner, so two sign-in tests never share an inbox.
 *
 * Not fussiness. Issuing a code INVALIDATES the previous one for that account, and the mail is
 * queued — so a test whose neighbour just signed in the same partner can read the neighbour's code
 * out of the inbox moments after the server killed it, and fail with «الرمز غير صحيح». It passes
 * alone and fails in sequence, which is the worst way for a test to be wrong. One account each
 * removes the race rather than timing around it.
 */
export const THIRD_PARTNER_EMAIL = 'partner2@safra.test';

/** Where mailpit is, for reading the sign-in code the API emails. */
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

/**
 * The newest sign-in code sitting in an address's inbox.
 *
 * ## Why the suite reads a mailbox now
 *
 * Partner sign-in used to be a TOTP code the tests could generate from a shared secret, offline
 * and instantly. Since 2026-08-20 the second factor is emailed, so the only way to complete a
 * partner sign-in is to read the mail — which is also the only way to prove the mail is actually
 * sent, and that it carries a code rather than an empty template.
 *
 * ## It polls, because delivery is queued
 *
 * Mail goes out through BullMQ, so the code is not in the inbox the instant the password is
 * accepted. Polling for a few seconds is the honest wait; a fixed `waitForTimeout` would be a
 * guess that is either too slow for every run or too fast for a loaded one.
 *
 * ## `since` is REQUIRED, and it is the whole correctness of this helper
 *
 * A fixture address accumulates codes across a run, and every one of them looks valid. Without a
 * lower bound this returned the newest mail ALREADY in the inbox — a code from a previous sign-in,
 * long since invalidated by the one being sent right now — and did it instantly, so the poll never
 * waited for the real mail at all. The sign-in then failed with a wrong code, which reads like a
 * broken feature rather than a broken test. Caught on 2026-08-20 the first time the partner setup
 * ran against emailed codes.
 *
 * Callers take the timestamp BEFORE submitting the password, so the window cannot miss a mail that
 * arrives while the request is still in flight.
 */
export async function signInCodeFor(
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> },
  address: string,
  since: Date,
): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const listed = (await (
      await request.get(`${MAILPIT}/api/v1/messages?limit=40`)
    ).json()) as {
      messages?: { ID: string; Created: string; To: { Address: string }[] }[];
    };

    for (const message of listed.messages ?? []) {
      if (!message.To.some((to) => to.Address === address)) continue;
      /* A second of slack: mailpit's clock and this process's need not agree exactly. */
      if (Date.parse(message.Created) < since.getTime() - 1000) continue;

      const body = (await (
        await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)
      ).json()) as { Text?: string };

      /*
        Matched on the BODY, not the subject: the subject is localised and this helper must not
        break the day somebody rewords it. Only the sign-in code mail contains a bare six-digit
        run — every other partner mail carries references, amounts and dates instead.
      */
      const found = /(?:^|\n)\s*(\d{6})\s*(?:\n|$)/.exec(body.Text ?? '');

      if (found?.[1]) return found[1];
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(
    `No sign-in code arrived for ${address} after ${since.toISOString()}. ` +
      'Is the BullMQ worker running? The mail goes out through the queue.',
  );
}
