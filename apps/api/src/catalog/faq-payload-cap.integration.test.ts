import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PUBLIC_FAQ_LIMIT } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { PropertyDetailService } from './property-detail.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * A property page's FAQ payload is bounded, whatever anybody does to the tables.
 *
 * ## What was unbounded, and why it mattered
 *
 * Both public reads returned every row that matched. The number of questions is an ADMIN decision
 * with no limit on it, and every answered one is three languages of up to 2,000 characters — on the
 * page rule 3 gives a 200ms p95 and a two-second load budget. Nothing else capped it: the contract
 * limits one partner REQUEST to 100 answers, which says nothing about how many rows accumulate.
 *
 * ## The cap is the backstop, not the alarm
 *
 * `catalogue-bounds.integration.test.ts` fails at 40 questions and names the work. This fires at
 * {@link PUBLIC_FAQ_LIMIT}, deliberately higher, so a page is never silently truncated before
 * somebody has been told the set outgrew the screen. Reaching this cap in production means the
 * alarm was ignored — and the page still renders finite, which is the point.
 *
 * Each case below was watched to fail: removing either `LIMIT` from `property-detail.service.ts`
 * turns the matching assertion red while the small-set control stays green.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the public FAQ payload', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const details = new PropertyDetailService(db, new SettingsService(db));

  beforeEach(async () => {
    await harness.begin();

    /*
      General entries are PLATFORM-wide, not scoped to a listing, so whatever the development
      database already holds counts toward the payload. Clearing them inside the transaction is
      what lets a case own the whole set and assert an exact length; the rollback puts them back.
      Without this the small-set control read 4 where it expected 2 — which is the control doing
      its job, on its first run.
    */
    await db.execute(sql`DELETE FROM general_faq_entries`);
  });
  afterEach(async () => {
    await harness.rollback();
  });
  afterAll(async () => {
    await harness.close();
  });

  /** A published listing, which is the only kind this endpoint serves. */
  async function aPublishedListing(): Promise<string> {
    const rows = await db.execute<{ slug: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id,
               (SELECT id FROM partners WHERE deleted_at IS NULL LIMIT 1) AS partner_id
      )
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, description_ar,
                              latitude, longitude, status)
      SELECT ref.partner_id, ref.city_id, ref.type_id, ref.policy_id,
             'faq-cap-' || gen_random_uuid(),
             'بيت السقف', 'Cap House', 'Cap Haus', 'شارع الاختبار ١٢',
             'وصف عربي كامل.', '33.5123', '36.2988', 'published'
      FROM ref
      RETURNING slug
    `);

    return rows.rows[0]?.slug ?? '';
  }

  /** `n` questions, each answered by this listing. */
  async function askAndAnswer(slug: string, n: number): Promise<void> {
    await db.execute(sql`
      WITH q AS (
        INSERT INTO property_faq_questions (question_ar, position)
        SELECT 'سؤال رقم ' || i, i FROM generate_series(1, ${n}) AS i
        RETURNING id
      )
      INSERT INTO property_faq_answers (property_id, question_id, answer_ar)
      SELECT p.id, q.id, 'إجابة.' FROM q, properties p WHERE p.slug = ${slug}
    `);
  }

  async function addGeneral(n: number): Promise<void> {
    await db.execute(sql`
      INSERT INTO general_faq_entries (question_ar, answer_ar, position)
      SELECT 'سؤال عام ' || i, 'إجابة عامة.', i FROM generate_series(1, ${n}) AS i
    `);
  }

  it(`returns at most ${PUBLIC_FAQ_LIMIT} answered questions`, async () => {
    const slug = await aPublishedListing();
    await askAndAnswer(slug, PUBLIC_FAQ_LIMIT + 11);

    const detail = await details.bySlug(slug);

    expect(detail.faq).toHaveLength(PUBLIC_FAQ_LIMIT);
  });

  it(`returns at most ${PUBLIC_FAQ_LIMIT} general entries`, async () => {
    const slug = await aPublishedListing();
    await addGeneral(PUBLIC_FAQ_LIMIT + 11);

    const detail = await details.bySlug(slug);

    expect(detail.generalFaq).toHaveLength(PUBLIC_FAQ_LIMIT);
  });

  /*
    The opposite control, and the reason the two above are worth anything. A `LIMIT 0`, a broken
    join or a predicate that matched nothing would satisfy «at most N» perfectly — this is what
    distinguishes a cap from a page that simply stopped returning its FAQ.
  */
  it('returns every entry when the set is small', async () => {
    const slug = await aPublishedListing();
    await askAndAnswer(slug, 3);
    await addGeneral(2);

    const detail = await details.bySlug(slug);

    expect(detail.faq).toHaveLength(3);
    expect(detail.generalFaq).toHaveLength(2);
  });

  /*
    The cap must take the FIRST entries by the operator's own ordering, not an arbitrary slice.
    A `LIMIT` without the `ORDER BY` beside it returns whatever the planner hands back, so the
    questions a reader meets would change between two identical requests.
  */
  it('keeps the operator’s order when it truncates', async () => {
    const slug = await aPublishedListing();
    await askAndAnswer(slug, PUBLIC_FAQ_LIMIT + 5);

    const detail = await details.bySlug(slug);

    expect(detail.faq[0]?.question.ar).toBe('سؤال رقم 1');
    expect(detail.faq.at(-1)?.question.ar).toBe(`سؤال رقم ${PUBLIC_FAQ_LIMIT}`);
  });
});
