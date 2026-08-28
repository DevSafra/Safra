import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SEEN_BADGE_CAP } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { MeService } from './me.service.js';
import { ReviewService } from './review.service.js';
import type { SanctionsService } from '../sanctions/sanctions.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * «What is new since I last looked» — the mark, and the badge it drives.
 *
 * Bashar, 2026-08-27: a badge counting the new rows on a section, those rows tinted when the page
 * opens, and both cleared once he has been there.
 *
 * ## What is worth asserting here rather than in a browser
 *
 * The ARITHMETIC and the boundary. `disputes.spec.ts`-style browser tests can show that a number
 * appears and later does not; they cannot show that «never looked» counts nothing rather than
 * everything, that the mark is per SECTION rather than global, or that the count stops at the cap.
 * Each of those is a decision that would look fine on screen while being wrong.
 */
/**
 * Where this file's window lives — a quarter-century before anything real.
 *
 * Everything here is expressed as «days into the window», so the numbers read as an ordering rather
 * than as dates. See the note on `customer` for why the window has to be somewhere nothing else
 * can reach.
 */
const ANCHOR = '2001-01-01T00:00:00Z';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('what is new since I last looked', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const me = new MeService(db);

  const review = new ReviewService(
    db,
    new AuditService(db),
    {} as unknown as SanctionsService,
    {} as unknown as SettingsService,
    {} as never,
    {} as never,
  );

  let staffId = '';
  let reader: AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES (${`seen-${randomUUID()}@safra.test`}, '+963900000140', 'super_admin', 'active')
      RETURNING id
    `);

    staffId = made.rows[0]?.id ?? '';
    reader = {
      sub: staffId,
      role: 'super_admin',
      permissions: [],
    } as unknown as AccessTokenClaims;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** How many customers this reader's badge would show. */
  const customersBadge = async (): Promise<number> =>
    Number((await review.attentionCounts(reader))['customers_new']);

  /**
   * A customer profile created `days` ago.
   *
   * ## An EMPTY window, anchored in 2001 — the isolation this file needs
   *
   * `attentionCounts` counts the whole table, and this database is shared with every other suite. A
   * customer committed by another spec between two reads here moves the number, and the first
   * version of this file used minute-scale ages around `now()` and did exactly that: it passed
   * alone and failed three ways inside `pnpm verify`.
   *
   * Two attempts were wrong before this one, and both are worth recording:
   *
   *  - **Ten days back.** The seeded testbed has real customers across the last fortnight, so the
   *    window was full of rows this file did not create. Earliest real customer: 2026-08-07.
   *  - **Ahead of now.** Nothing can be in the future, which made it perfectly isolated — and
   *    unusable, because `markSeen` CLAMPS a reported frontier to `now()`. That clamp is a
   *    safeguard worth keeping, so the test moved rather than the rule.
   *
   * 2001 is empty by inspection (`count(*) WHERE created_at < '2010-01-01'` is zero) and stays
   * empty, because nothing creates a row there. The dates are nonsense as data and that costs
   * nothing: `created_at` is never rendered by the counter under test, and the transaction rolls
   * back.
   */
  async function customer(days: number): Promise<void> {
    await db.execute(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest, created_at)
      VALUES ('عميل جديد', ${`seen-c-${randomUUID()}@safra.test`}, '+963900000141', false,
              ${ANCHOR}::timestamptz + (${days}::numeric * INTERVAL '1 day'))
    `);
  }

  /**
   * A batch spanning a closed window AHEAD of now: `since` days from now, read down to `readTo`.
   *
   * The upper bound is what keeps other suites out — see `customer`. `readTo` is part of the
   * feature, not a testing device: it is «the oldest row I have had on screen», and starting a case
   * with one simply means the reader has already paged down that far.
   */
  async function batchBetween(
    section: string,
    sinceDays: number,
    readToDays: number,
  ): Promise<void> {
    await db.execute(sql`
      UPDATE users
      SET section_seen_at = jsonb_set(
            coalesce(section_seen_at, '{}'::jsonb), array[${section}::text],
            jsonb_build_object(
              'since',  to_jsonb(${ANCHOR}::timestamptz + (${sinceDays}::numeric * INTERVAL '1 day')),
              'readTo', to_jsonb(${ANCHOR}::timestamptz + (${readToDays}::numeric * INTERVAL '1 day')),
              'readFrom', 'null'::jsonb),
            true)
      WHERE id = ${staffId}::uuid
    `);
  }

  /** This reader's two marks for a section, as the console would read them. */
  const marks = async (
    section: string,
  ): Promise<
    { since: string; readTo: string | null; readFrom: string | null } | undefined
  > => (await me.preferences(staffId)).sectionSeenAt[section];

  /**
   * THE assertion, and the one a wrong default would fail silently.
   *
   * A staff member who has never opened العملاء sees NO badge — not one counting every customer
   * the platform has ever had. The database makes that true by construction: an absent key gives
   * `created_at > NULL`, which is NULL rather than TRUE. Written down because the obvious
   * alternative — coalescing the mark to the epoch — reads as more careful and is far worse.
   */
  it('counts nothing for a reader who has never opened the section', async () => {
    await customer(9.2);
    await customer(9.4);

    expect(await customersBadge()).toBe(0);
  });

  it('counts the rows that arrived after the mark, and not the ones before it', async () => {
    await batchBetween('customers', 9, 11);

    const before = await customersBadge();

    await customer(9.6);
    await customer(9.2);
    /* Older than the mark — the control, without which `count(*)` would pass too. */
    await customer(8.5);

    expect(await customersBadge()).toBe(before + 2);
  });

  /**
   * The mark is per SECTION, not one «last seen» for the console.
   *
   * Opening المحفظة must not clear العملاء. A single timestamp would look identical on the screen
   * that was opened and quietly wrong on the four that were not.
   */
  it('keeps one section’s mark out of another’s', async () => {
    await batchBetween('customers', 9, 11);
    await customer(9.6);

    const before = await customersBadge();

    expect(before).toBeGreaterThan(0);

    await me.markSeen(staffId, { section: 'wallet', readTo: await ageIso(8.5) });

    expect(await customersBadge(), 'المحفظة did not clear العملاء').toBe(before);

    /* Reading العملاء to its end empties the badge — and leaves the batch standing. */
    await me.markSeen(staffId, { section: 'customers', readTo: await ageIso(8.5) });

    expect(await customersBadge(), 'nothing is unread any more').toBe(0);

    const readOut = await marks('customers');

    expect(
      Date.parse(readOut?.since ?? ''),
      'but the batch still stands, so the rows stay marked',
    ).toBe(Date.parse(await ageIso(9)));
  });

  /**
   * The count STOPS at the cap.
   *
   * Every other badge counts a queue that empties, so an exact figure is cheap. This one has no
   * bound, and an operator away for a month would otherwise ask the database to count every row
   * since — on every page view, which rule 2 forbids. The badge prints «99+» past this, because a
   * total that stopped counting must never present itself as a measurement.
   */
  it('stops counting at the cap', async () => {
    await batchBetween('customers', 9, 11);

    for (let index = 0; index < SEEN_BADGE_CAP + 5; index += 1) await customer(9.6);

    const counted = await customersBadge();

    expect(
      counted,
      'it stopped reading rather than counting them all',
    ).toBeLessThanOrEqual(SEEN_BADGE_CAP + 1);
    expect(counted, 'and it did reach the cap').toBeGreaterThan(SEEN_BADGE_CAP);
  });

  /**
   * ── Bashar's report, 2026-08-28 ─────────────────────────────────────────
   *
   * «when I go to the next page on the table, I do not see the new row marked and the badge number
   * get removed… the badge number should only decrease when I see the new rows on the current
   * page».
   *
   * Reading the first page must take the badge down by what that page showed, and NOT by the rest.
   * The first version advanced a single mark to `now()` on arrival, so this went straight to zero
   * and page two's rows stopped being new — which is the defect, expressed as arithmetic.
   */
  it('takes the badge down by the page that was read, not by the batch', async () => {
    await batchBetween('customers', 9, 11);

    /* Six new rows, at known ages, newest first: 10, 20, 30, 40, 50, 55 minutes ago. */
    for (const age of [9.2, 9.4, 9.6, 9.8, 10.2, 10.5]) await customer(age);

    const all = await customersBadge();

    expect(all, 'all six are unread to begin with').toBeGreaterThanOrEqual(6);

    /*
      «Page one» showed the newest three — the three largest offsets, 10.5, 10.2 and 9.8 — so the
      oldest row on it is the one at 9.8, and that is the frontier the console would report.
    */
    await me.markSeen(staffId, { section: 'customers', readTo: await ageIso(9.8) });

    const left = await customersBadge();

    expect(all - left, 'the three that were on screen are read').toBe(3);
    expect(left, 'and the three below them are not').toBeGreaterThanOrEqual(3);
  });

  /**
   * Paging BACK does not un-read anything.
   *
   * The frontier only ever moves down. Without that, returning to page one after page two would
   * raise `readTo` again and the badge would climb — rows the reader has already been shown
   * presenting themselves as new a second time.
   */
  it('never moves the frontier back up', async () => {
    await batchBetween('customers', 9, 11);

    for (const age of [9.2, 9.4, 9.6, 9.8, 10.2, 10.5]) await customer(age);

    /* Down to page two, whose oldest row is the deepest of the batch. */
    await me.markSeen(staffId, { section: 'customers', readTo: await ageIso(9.2) });

    const deep = await customersBadge();

    /* And back to page one, whose oldest row is much newer. */
    await me.markSeen(staffId, { section: 'customers', readTo: await ageIso(9.8) });

    expect(await customersBadge(), 'paging back re-reads nothing').toBe(deep);
    /*
      Compared as an INSTANT, not as text: Postgres renders the offset as `+00:00` and `to_char`
      writes `Z`, which are the same moment spelled two ways.
    */
    expect(
      Date.parse((await marks('customers'))?.readTo ?? ''),
      'and the frontier stayed down',
    ).toBe(Date.parse(await ageIso(9.2)));
  });

  /**
   * A finished batch RE-OPENS from the top of what was seen, and nothing is lost.
   *
   * ## The case, and the two wrong answers before this one
   *
   * A reader finishes a batch and stays. Rows arrive above everything they have seen. Retiring the
   * batch at `now()` put those rows BEHIND the next boundary and they were never marked at all.
   * Counting them with a second rule — «newer than the top I saw» — put them in the badge and then
   * reproduced the original defect one level up: reading the newest of them moved that top past the
   * others, and the rest fell through both rules at once. Found in a full-suite run on 2026-08-28.
   *
   * Re-opening needs no second rule. The batch simply starts again from the top of what was seen,
   * and every rule that governs a batch governs these rows unchanged.
   */
  it('re-opens a finished batch from the top of what was seen', async () => {
    await batchBetween('customers', 9, 11);

    for (const age of [9.2, 9.6]) await customer(age);

    /* Read it out. See the note on `topOfPage` in the case below for why this is behind now. */
    const topOfPage = new Date(Date.now() - 10_000).toISOString();

    await me.markSeen(staffId, {
      section: 'customers',
      readFrom: topOfPage,
      readTo: await ageIso(8.5),
    });

    expect(await customersBadge(), 'nothing unread').toBe(0);

    /* Two arrive, above everything that was seen, and both reportable. */
    const older = await arrivesRecently(4);
    const newer = await arrivesRecently(2);

    /* The reader's next page shows the NEWEST of them, and only that one. */
    await me.markSeen(staffId, { section: 'customers', readFrom: newer, readTo: newer });

    /*
      At least the one below it. «Between the top of what was seen and the row just shown» is a live
      window a few seconds wide, so another suite committing a customer into it is legitimately
      unread too — the exact assertions are on the marks below.
    */
    expect(
      await customersBadge(),
      'the one below it is unread — it must not be stranded by reading the newest',
    ).toBeGreaterThanOrEqual(1);

    const after = await marks('customers');

    expect(
      Date.parse(after?.since ?? ''),
      'and the batch re-opened from the top of what had been seen',
    ).toBe(Date.parse(topOfPage));
    expect(
      Date.parse(after?.readTo ?? ''),
      'with the frontier at the row just shown',
    ).toBe(Date.parse(newer));
    /* The control: the older arrival is the one the badge is counting. */
    expect(Date.parse(older)).toBeLessThan(Date.parse(newer));
  });

  /**
   * A customer arriving `secondsAgo` before now — above everything the fixture window holds.
   *
   * Recent rather than dated from the window's anchor, because a re-opened batch starts at the top
   * of what was SEEN and that is a recent moment. And in the PAST rather than the future, because
   * `markSeen` clamps a reported mark to `now()`: a future row can be created but never reported,
   * which is the schema doing its job and a fixture asking the wrong question.
   */
  async function arrivesRecently(secondsAgo: number): Promise<string> {
    const rows = await db.execute<{ at: string }>(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest, created_at)
      VALUES ('عميل لاحق', ${`seen-n-${randomUUID()}@safra.test`}, '+963900000142', false,
              now() - (${secondsAgo}::numeric * INTERVAL '1 second'))
      RETURNING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
    `);

    return rows.rows[0]?.at ?? '';
  }

  /** An ISO timestamp `days` into the window — the same clock the fixture rows use. */
  async function ageIso(days: number): Promise<string> {
    const rows = await db.execute<{ at: string }>(sql`
      SELECT to_char((${ANCHOR}::timestamptz + (${days}::numeric * INTERVAL '1 day'))
                     AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
    `);

    return rows.rows[0]?.at ?? '';
  }

  /**
   * ── Bashar's report, 2026-08-28 ─────────────────────────────────────────
   *
   * «when I change the rows number from 10 to 25, new rows are not marked anymore and the badge
   * number gets hidden».
   *
   * A page LARGER than the batch shows past its end. That is not a decision to finish with the
   * section, and it must not move the boundary — otherwise the tint disappears from under the rows
   * the reader is looking at, which is what he met.
   *
   * The badge legitimately empties: he has been shown all of them. The BOUNDARY is what has to
   * hold, because that is what the tint follows.
   */
  it('does not end a batch just because the page overshot it', async () => {
    await batchBetween('customers', 9, 11);

    for (const age of [9.2, 9.4, 9.6]) await customer(age);

    expect(await customersBadge(), 'three unread to begin with').toBe(3);

    /*
      «Twenty-five rows» — a page reaching well past the three new ones, so its oldest row is older
      than the boundary itself.
    */
    await me.markSeen(staffId, { section: 'customers', readTo: await ageIso(8.5) });

    expect(await customersBadge(), 'all three have been shown').toBe(0);

    const after = await marks('customers');

    expect(
      Date.parse(after?.since ?? ''),
      'and the batch still stands, so the rows are still marked',
    ).toBe(Date.parse(await ageIso(9)));
    expect(
      Date.parse(after?.readTo ?? ''),
      'the frontier stopped at the boundary rather than passing it',
    ).toBe(Date.parse(await ageIso(9)));
  });

  /** The mark round-trips through the reader's own preferences, which is how the console gets it. */
  it('reads back the mark it wrote', async () => {
    expect(await marks('customers')).toBeUndefined();

    await me.markSeen(staffId, { section: 'customers' });

    const stored = (await marks('customers'))?.since;

    expect(stored, 'the console can read what was marked').toBeDefined();
    /*
      And it is the DATABASE's clock, not a value from the request. A caller that could name the
      moment could backdate it and keep a badge alive for ever, or post-date it and blank a
      registry it has never opened.
    */
    expect(Math.abs(Date.now() - Date.parse(stored ?? '')), 'stamped now').toBeLessThan(
      60_000,
    );
  });
});
