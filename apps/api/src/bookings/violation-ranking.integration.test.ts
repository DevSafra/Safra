import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * Recording a violation does NOT move a partner's ranking (Bashar, 2026-08-24).
 *
 * > *"Violations must not directly affect ranking… creating a violation must not automatically
 * > modify ranking. If ranking consequences are desired in the future, they should be derived from
 * > objective platform metrics rather than administrative violation records."*
 *
 * ## Why a test rather than a deleted line
 *
 * Because "a partner who does this should rank lower" is an intuitive thing to believe, and the two
 * deductions that used to exist were each written deliberately, with a §8.5 citation arguing for
 * them. Somebody will restore one in good faith. This is what stops that being silent.
 *
 * ## Why it asserts on the COLUMN and not on a search result
 *
 * `partners.score` feeds `recommendation_score`, which is the default search order — so the column
 * is the coupling. Asserting on a search result instead would need a whole indexed corpus to prove
 * a number did not move, and would fail for a dozen reasons that have nothing to do with the rule.
 *
 * ## What is deliberately still allowed to move
 *
 * `cancellation_count`. Bashar names cancellation rates as a legitimate quality signal by hand, and
 * that column counts CANCELLATIONS rather than violations — it is a measurement, not a punishment
 * attached to a record. The second test pins that distinction, because a change that removed both
 * would satisfy the first test perfectly and quietly drop a signal he asked to keep.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a violation and a partner’s ranking', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let partnerId = '';
  let run = 0;

  async function makePartner(): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1) AS type_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${`rank-${process.pid}-${run}@safra.test`}, '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, ref.type_id, 'Rank', 'رتبة', ref.city_id, 'x', '+963900000000',
             ${`rank-${process.pid}-${run}@safra.test`}, 'approved'
      FROM u, ref
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  }

  const scoreOf = async (id: string) => {
    const row = await db.execute<{ score: number; cancellations: number }>(sql`
      SELECT score, cancellation_count AS cancellations FROM partners WHERE id = ${id}::uuid
    `);

    return row.rows[0];
  };

  beforeEach(async () => {
    await harness.begin();
    run += 1;
    partnerId = await makePartner();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * The ranking column is untouched by a violation, whatever its severity says.
   *
   * `score_penalty` is written — it records the severity the platform assigned — and it must not
   * be applied to anything. That column is exactly the shape of a value somebody would later wire
   * up "because it is already there".
   */
  it('leaves partners.score alone when a violation is recorded', async () => {
    const before = await scoreOf(partnerId);

    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, score_penalty)
      VALUES (${partnerId}::uuid, 'no_response', 1, 5)
    `);

    const after = await scoreOf(partnerId);

    expect(after?.score).toBe(before?.score);
  });

  it('leaves it alone for a rejected-after-payment violation too', async () => {
    const before = await scoreOf(partnerId);

    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, score_penalty)
      VALUES (${partnerId}::uuid, 'rejected_after_payment', 1, 2)
    `);

    expect((await scoreOf(partnerId))?.score).toBe(before?.score);
  });

  /**
   * The control, and the one that keeps this from over-correcting.
   *
   * A cancellation still counts, because Bashar names cancellation rates as a legitimate quality
   * signal. Removing both writes would pass the two tests above and silently drop a measurement he
   * asked to keep — so the rule is not "nothing may move", it is "an administrative record may not
   * move it".
   */
  it('still counts a cancellation, which is a measurement rather than a punishment', async () => {
    const before = await scoreOf(partnerId);

    await db.execute(sql`
      UPDATE partners SET cancellation_count = cancellation_count + 1
      WHERE id = ${partnerId}::uuid
    `);

    const after = await scoreOf(partnerId);

    expect(after?.cancellations).toBe((before?.cancellations ?? 0) + 1);
    expect(after?.score).toBe(before?.score);
  });

  /**
   * No live code path deducts from `partners.score` any more.
   *
   * The two tests above prove the paths they name. This one asks the general question the way the
   * anonymity suite does — because the next deduction will be written somewhere neither of them
   * looks, and a grep is the only assertion that covers a file that does not exist yet.
   */
  it('has no remaining score deduction anywhere in the API', async () => {
    /*
      Imported as a namespace rather than destructured: the lint rule forbids separating a method
      from its object without a `this: void` declaration, and `node:fs`'s functions trip it.
    */
    const fs = await import('node:fs');
    const path = await import('node:path');

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const entry = path.join(dir, name);

        if (fs.statSync(entry).isDirectory()) {
          walk(entry);
          continue;
        }

        if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;

        const source = fs.readFileSync(entry, 'utf8');

        /*
      A plain text search, which CANNOT tell code from comment — and that cost is deliberate.

      It caught my own docblock the first time I ran it, because the comment explaining the removal
      quoted the removed statement verbatim. The fix was to make the comment DESCRIBE the deduction
      rather than reproduce it, which is better writing anyway: a comment that contains runnable
      SQL invites somebody to uncomment it.

      The alternative — parsing to exclude comments — buys accuracy in the one case where a false
      positive is harmless and costs the property that makes this worth having, which is that it is
      three lines and obviously correct.
    */
        if (/SET\s+score\s*=\s*GREATEST\([^)]*score\s*-/i.test(source))
          offenders.push(entry);
      }
    };

    walk(path.join(process.cwd(), 'apps/api/src'));

    expect(offenders).toEqual([]);
  });
});
