import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '@safra/contracts';
import { adminMessages, payloadWord } from '@safra/i18n';
import { createDatabase, type Database } from '@safra/db';

/**
 * The values the platform has actually written are all values the console can name.
 *
 * ## Why this is separate from `audit-actions.test.ts`
 *
 * That test compares two lists in the repository: the declared actions and their Arabic labels. It
 * cannot see an action the code emits and nobody declared — which is the failure that happened.
 * Five call sites build the action with a template literal (`partner.${nextStatus}`,
 * `property.${decision === 'approve' ? 'approved' : 'rejected'}`, and three more), so grepping the
 * source finds ONE action where there are two, and `partner.rejected` and `property.rejected` were
 * both missing while their approvals were present. They are the outcomes of the two verification
 * queues the console exists to work.
 *
 * The database does not have that blind spot. Whatever was written is there, spelled the way the
 * code spelled it.
 *
 * ## Vacuous passes are visible, not silent
 *
 * Over an empty `audit_log` this proves nothing, so the row count is asserted and printed. That is
 * the lesson from `pnpm load:invariants`, which reported "all invariants hold" over two empty tables
 * on 2026-08-20 and was only readable because it printed what it had counted.
 *
 * Read-only: safe against any environment.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * Codes a compile-time catalogue cannot translate, and why not.
 *
 * **Five entries left this list on 2026-09-08**, when `payloadValue` gained a per-FIELD map
 * (finding 226). `original`, `joint` and `safra` are contract copies and now read as such under
 * `party`; `base` is a contract kind and reads under `kind`; and `restaurant` was excused as «an
 * operator-editable property type» when the value in the log is an ADVERTISER kind, which is a
 * fixed enum with a word. Four of the five were not untranslatable at all — they were unresolvable
 * by a map keyed on the value alone, which is a different thing, and the difference had been
 * recorded as a decision for eleven days.
 *
 * Not a convenience list. Each group is something the console is RIGHT to print as it is stored,
 * and `payloadValue`'s own note already says so of one of them: «a list of slugs stays as slugs,
 * which is what a slug is for».
 */
const UNTRANSLATABLE = new Set<string>([
  /*
    City slugs. A slug is an identifier a super admin coins when adding a city, so no catalogue
    shipped with the code can know it — and the city's Arabic NAME is a column on the row, which is
    what every screen that names a city reads.
  */
  'damascus',
  'aleppo',
  'latakia',
  'tartus',
  'palmyra',
  'kasab',
  'aqaba',
  'petra',
  'tripoli',

  /*
    City-CATEGORY codes and amenity codes, for the same reason one layer down: both are rows a
    super admin creates with their own `name_ar`, and `city_category.updated` audits the code
    because the code is the thing that changed.
  */
  'coastal',
  'mountain',
  'desert',
  'rural',
  'historic',
  'wifi',
  'facilities',

  /*
    A payment PROVIDER's name. `simulator` is the development gateway and the real ones will be
    Visa, Mastercard and Sham Cash — brand names, which are not translated on any surface.
  */
  'simulator',

  /* Fixture noise from the testbed seed, which is not a code at all. */
  'test',
]);

describeIfDb('what the platform has written, the console can name', () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(DATABASE_URL ?? '', 2);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  const distinct = async (table: string, column: string): Promise<string[]> => {
    const rows = await db.execute<{ v: string }>(
      sql.raw(
        `SELECT DISTINCT ${column}::text AS v FROM ${table} WHERE ${column} IS NOT NULL ORDER BY 1`,
      ),
    );

    return rows.rows.map((row) => row.v);
  };

  it('has written enough for this suite to mean anything', async () => {
    const rows = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM audit_log`,
    );

    const total = Number(rows.rows[0]?.n ?? 0);

    console.log(`audit_log holds ${total.toLocaleString('en')} rows`);

    expect(
      total,
      'An empty audit_log makes every assertion below pass without checking anything. Seed the ' +
        'testbed (`pnpm db:testbed`) before trusting this suite.',
    ).toBeGreaterThan(0);
  });

  it('declares every action present in audit_log', async () => {
    const declared = new Set<string>(AUDIT_ACTIONS);
    const unknown = (await distinct('audit_log', 'action')).filter(
      (action) => !declared.has(action),
    );

    expect(
      unknown,
      'These actions were WRITTEN by the platform and are not in AUDIT_ACTIONS, so the console ' +
        'shows the raw identifier. Add them to packages/contracts/src/audit-actions.ts with an ' +
        'Arabic label — and check the spelling against the service that writes them, because ' +
        'audit_log is append-only.',
    ).toEqual([]);
  });

  it('names every subject type present in audit_log', async () => {
    const catalogue = adminMessages('ar').auditSubject;
    const unknown = (await distinct('audit_log', 'subject_type')).filter(
      (subject) => !(subject in catalogue),
    );

    expect(unknown, 'Add these to `auditSubject` in messages/admin/ar.ts.').toEqual([]);
  });

  /**
   * The FIELD NAMES inside the payload, which the console prints under «الحقل».
   *
   * سجل التدقيق draws `before`/`after` through `payloadKey`, and that map held eighteen entries
   * written for the booking timeline while the platform writes seventy-four keys. Everything not
   * in it printed as the stored identifier — `basePrice`, `confirmationWindowMinutes`,
   * `ledgerEntryGroup` — English, on a console that is Arabic-only (Bashar, 2026-08-20).
   *
   * Read from the database rather than from the code for the reason this whole file exists: a
   * payload is built from a spread at several call sites, so grepping the source under-reports
   * what actually reaches the column.
   */
  it('names every payload field present in audit_log', async () => {
    const catalogue = adminMessages('ar').enums.payloadKey;
    const rows = await db.execute<{ k: string }>(sql`
      SELECT DISTINCT k
      FROM audit_log,
           LATERAL jsonb_object_keys(
             coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb)
           ) AS k
      ORDER BY 1
    `);

    const unknown = rows.rows.map((row) => row.k).filter((key) => !(key in catalogue));

    expect(
      unknown,
      'These keys appear in an audit payload and have no Arabic name, so سجل التدقيق prints the ' +
        'identifier. Add them to `enums.payloadKey` in messages/admin/ar.ts.',
    ).toEqual([]);
  });

  /**
   * And the enum-shaped VALUES, which the console prints under «قبل» and «بعد».
   *
   * Only values that LOOK like codes. A `reason` somebody typed is their own words and must fall
   * through untranslated; a `status` of `pending_confirmation` is an identifier and must not reach
   * a reader. Three structural rules separate the two, and each of them was earned:
   *
   * 1. **The jsonb type is `string`.** It was `jsonb_each_text`, which stringifies a boolean into
   *    `'true'` — so the guard demanded an Arabic word for `true` while the console was already
   *    rendering it «نعم» through `payloadValue`'s boolean branch. Asking the type instead of the
   *    text removes that whole argument rather than exempting two values.
   * 2. **The pattern allows a SINGLE word.** It required at least one underscore
   *    (`^[a-z][a-z0-9]*(_[a-z0-9]+)+$`), which made every one-word code invisible to it: on
   *    2026-09-08 the audit entry for `dispute.notified` read «الشريك: queued» and «العميل:
   *    queued» — English, on a console that is Arabic-only — and 51 such codes were reaching
   *    readers, none of them visible to this test since the day it was written. Found by opening
   *    the screen, not by the suite. Twenty-five were named the same day from words the catalogue
   *    already used elsewhere; the rest are exempted below, each with a reason.
   * 3. **At most 24 characters.** `documentHash` and `fileHash` carry SHA-256 digests, which are
   *    64 lowercase hex characters and match any «looks like a code» pattern perfectly. No enum
   *    value on this platform is longer than a couple of words.
   */
  it('names every coded payload value present in audit_log', async () => {
    /*
      Walked as (FIELD, value) pairs, and resolved through `payloadWord` — the same function the
      console's `payloadValue` calls (finding 226).

      It compared values against the flat map alone, which could not see a code whose word depends
      on its field: `party: original` had no entry and was exempted as untranslatable, when in
      truth it simply needed resolving under `party`. Asking the pair, through the screen's own
      resolver, is the only form of this check that cannot pass over an identifier a reader meets.
    */
    const rows = await db.execute<{ k: string; v: string }>(sql`
      SELECT DISTINCT e.key AS k, e.value #>> '{}' AS v
      FROM audit_log,
           LATERAL jsonb_each(
             coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb)
           ) AS e(key, value)
      WHERE jsonb_typeof(e.value) = 'string'
        AND e.value #>> '{}' ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
        AND length(e.value #>> '{}') <= 24
      ORDER BY 1, 2
    `);

    const unknown = rows.rows
      .filter((row) => payloadWord(row.k, row.v) === null && !UNTRANSLATABLE.has(row.v))
      .map((row) => `${row.k}: ${row.v}`);

    expect(
      unknown,
      'These coded values appear in an audit payload with no Arabic word, so سجل التدقيق prints ' +
        'the code. Add them to `enums.payloadValue` in messages/admin/ar.ts — and pick the ' +
        'wording deliberately: the status vocabularies disagree with each other on purpose. If a ' +
        'value genuinely cannot be translated at compile time, add it to UNTRANSLATABLE with the ' +
        'reason, not here.',
    ).toEqual([]);
  });

  /**
   * The exemptions are held to account, because an exemption list decays in the direction of
   * hiding things.
   *
   * Every entry must still be PRESENT in a payload. A value that has stopped being written is a
   * value whose reason nobody has re-read, and leaving it here would let a future code of the same
   * name pass unexamined — which is the failure mode this project has already met once, in a list
   * excusing a page that «cannot gate» while the page grew a real guard.
   */
  it('exempts nothing that has stopped being written', async () => {
    const rows = await db.execute<{ v: string }>(sql`
      SELECT DISTINCT e.value #>> '{}' AS v
      FROM audit_log,
           LATERAL jsonb_each(
             coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb)
           ) AS e(key, value)
      WHERE jsonb_typeof(e.value) = 'string'
    `);

    const present = new Set(rows.rows.map((row) => row.v));
    const stale = [...UNTRANSLATABLE].filter((code) => !present.has(code)).sort();

    expect(
      stale,
      'These are exempted from translation and nothing writes them any more. Remove them — a ' +
        'stale exemption silently covers the next value that happens to share the name.',
    ).toEqual([]);
  });

  /**
   * The same class of gap, one table over.
   *
   * The catalogue listed the six templates from design handoff §8 and the platform sends three
   * entirely different ones — `booking.needs_action`, `review.received`, `review.replied` — so every
   * row of سجل واتساب والبريد was untranslatable. Zero overlap between what was described and what
   * was built.
   */
  it('names every notification template that has been sent', async () => {
    const catalogue = adminMessages('ar').notificationTemplate;
    const unknown = (await distinct('notifications', 'template_key')).filter(
      (key) => !(key in catalogue),
    );

    expect(
      unknown,
      'Add these to `notificationTemplate` in messages/admin/ar.ts.',
    ).toEqual([]);
  });
});
