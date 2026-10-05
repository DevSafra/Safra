import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { PropertiesService } from './properties.service.js';

/**
 * الأسئلة الشائعة — answering SAFRA's questions, and what a required one blocks.
 *
 * ## Why the questions are created HERE and not seeded
 *
 * `property_faq_questions` is platform-wide: a required question added to the development database
 * blocks submission for every listing in it, which is exactly what happened when this feature was
 * first driven — two existing readiness tests went red because a fixture SAFRA asks of everybody
 * had appeared under them. That is the behaviour working, and it is also a fixture nobody else
 * should have to know about. The rollback harness gives each case its own question and takes it
 * away again, so the suite is not carrying a platform-wide requirement between files.
 *
 * ## What is actually being protected
 *
 * Three things, and each is watched to fail:
 *
 * - a REQUIRED question refuses submission while unanswered, and stops refusing once answered;
 * - an OPTIONAL question never refuses, so «required» means something;
 * - a partner cannot answer on a listing that is not theirs, and cannot answer a RETIRED question.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the property FAQ', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new PropertiesService(db, new AuditService(db));

  let partnerId = '';
  let partnerUserId = '';
  let otherPartnerId = '';

  const partner = (): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [P.PROPERTY_MANAGE_OWN, P.PRICE_UPDATE],
    locale: 'ar',
    totpEnabled: true,
    partnerId,
  });

  /** A second partner, so «not yours» can be tested rather than assumed. */
  const other = (): AccessTokenClaims => ({ ...partner(), partnerId: otherPartnerId });

  async function aPartner(): Promise<{ partnerId: string; userId: string }> {
    const made = await db.execute<{ partner_id: string; user_id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        SELECT 'faq-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
               'partner', 'active', 'ar'
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, 'FAQ Test', 'FAQ Test', ref.city_id,
               'x', '+963900000000', 'faq@safra.test', 'approved'
        FROM u, ref
        RETURNING id, user_id
      )
      SELECT id AS partner_id, user_id FROM pa
    `);

    return {
      partnerId: made.rows[0]?.partner_id ?? '',
      userId: made.rows[0]?.user_id ?? '',
    };
  }

  beforeEach(async () => {
    await harness.begin();

    const mine = await aPartner();
    const theirs = await aPartner();

    partnerId = mine.partnerId;
    partnerUserId = mine.userId;
    otherPartnerId = theirs.partnerId;

    /* A fixture that cannot reach the rule reports coverage it does not have. */
    if (!partnerId || !otherPartnerId)
      throw new Error('the FAQ fixture built no partner');
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** A submittable draft: a unit, a location, a photograph and an Arabic description. */
  async function aDraft(owner = partnerId): Promise<string> {
    const rows = await db.execute<{ reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id,
               (SELECT id FROM currencies LIMIT 1) AS currency_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, description_ar,
                                latitude, longitude, status)
        SELECT ${owner}, ref.city_id, ref.type_id, ref.policy_id,
               'faq-test-' || gen_random_uuid(),
               'بيت الأسئلة', 'FAQ House', 'FAQ Haus', 'شارع الاختبار ١٢',
               'وصف عربي كامل.', '33.5123', '36.2988', 'draft'
        FROM ref
        RETURNING id, reference
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, min_nights)
        SELECT pr.id, 'غرفة', 'Room', 'Zimmer', 2, 75000, ref.currency_id, 1
        FROM pr, ref
        RETURNING id
      ), im AS (
        INSERT INTO property_images (property_id, file_key, status, sort_order)
        -- 'ready', not 'published': imageIsPublished reads status = 'ready', and the enum has no
        -- 'published' at all. A fixture that cannot reach the rule reports coverage it has not got.
        SELECT pr.id, 'faq-test.jpg', 'ready', 1 FROM pr
        RETURNING id
      )
      SELECT reference FROM pr
    `);

    return rows.rows[0]?.reference ?? '';
  }

  /** One question SAFRA asks, required or not. Created per case, rolled back after. */
  async function aQuestion(required: boolean, active = true): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO property_faq_questions (question_ar, is_required, is_active, position)
      VALUES ('هل الإفطار مشمول؟', ${required}, ${active}, 1)
      RETURNING id
    `);

    return rows.rows[0]?.id ?? '';
  }

  it('refuses submission while a REQUIRED question is unanswered', async () => {
    const reference = await aDraft();
    await aQuestion(true);

    await expect(service.submitForReview(partner(), reference)).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.FAQ_ANSWER_REQUIRED,
    );
  });

  it('accepts the same listing once the required question is answered', async () => {
    const reference = await aDraft();
    const questionId = await aQuestion(true);

    await service.saveFaqAnswers(partner(), reference, {
      answers: [
        {
          questionId,
          answerAr: 'نعم، إفطار شرقي مشمول.',
          answerEn: null,
          answerDe: null,
        },
      ],
    });

    const result = await service.submitForReview(partner(), reference);

    expect(result.status).toBe('pending_review');
  });

  /*
    The opposite control. Without it, «required blocks submission» would pass just as happily if
    EVERY question blocked it — and the word would mean nothing.
  */
  it('never refuses submission for an OPTIONAL question left unanswered', async () => {
    const reference = await aDraft();
    await aQuestion(false);

    const result = await service.submitForReview(partner(), reference);

    expect(result.status).toBe('pending_review');
  });

  it('answers only whitespace do not satisfy a required question', async () => {
    const reference = await aDraft();
    const questionId = await aQuestion(true);

    /*
      The contract trims and refuses an empty answer, so this goes in under the contract to reach
      the SQL — which is the layer that decides whether a blank counts. A caller reaching the
      service directly is a real path: the test does it, and so would any future internal caller.
    */
    await db.execute(sql`
      INSERT INTO property_faq_answers (property_id, question_id, answer_ar)
      SELECT p.id, ${questionId}, '   '
        FROM properties p WHERE p.reference = ${reference}
    `);

    await expect(service.submitForReview(partner(), reference)).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.FAQ_ANSWER_REQUIRED,
    );
  });

  it('refuses an answer on a listing belonging to another partner', async () => {
    const reference = await aDraft(otherPartnerId);
    const questionId = await aQuestion(false);

    await expect(
      service.saveFaqAnswers(partner(), reference, {
        answers: [{ questionId, answerAr: 'محاولة', answerEn: null, answerDe: null }],
      }),
    ).rejects.toSatisfy((error: unknown) => codeOf(error) === ERROR.PROPERTY_NOT_FOUND);

    /* The opposite control: the owner CAN answer it, so the refusal is about ownership. */
    const owned = await service.saveFaqAnswers(other(), reference, {
      answers: [{ questionId, answerAr: 'إجابة المالك', answerEn: null, answerDe: null }],
    });

    expect(owned.saved).toBe(1);
  });

  it('refuses an answer to a RETIRED question', async () => {
    const reference = await aDraft();
    const questionId = await aQuestion(false, false);

    await expect(
      service.saveFaqAnswers(partner(), reference, {
        answers: [{ questionId, answerAr: 'إجابة', answerEn: null, answerDe: null }],
      }),
    ).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.FAQ_QUESTION_UNAVAILABLE,
    );
  });

  it('saves an answer once and updates it in place on a second save', async () => {
    const reference = await aDraft();
    const questionId = await aQuestion(false);

    await service.saveFaqAnswers(partner(), reference, {
      answers: [{ questionId, answerAr: 'الأولى', answerEn: null, answerDe: null }],
    });
    await service.saveFaqAnswers(partner(), reference, {
      answers: [{ questionId, answerAr: 'الثانية', answerEn: null, answerDe: null }],
    });

    const { questions } = await service.faqForOwn(partner(), reference);
    const answered = questions.filter((q) => q.answerAr !== null);

    /* One row, not two: the unique index and the upsert agree. */
    expect(answered).toHaveLength(1);
    expect(answered[0]?.answerAr).toBe('الثانية');
  });

  /*
    A question retired AFTER it was answered (audit 2026-10-04).

    The portal keeps showing that answer and says «إجابتك تبقى ظاهرة ويمكنك تعديلها», and the form
    sends it back with every save. The write only accepted ACTIVE questions, so the retired one
    found no row, threw, and rolled back the whole save: one retired question froze every answer on
    the listing, required ones included. Editing an existing answer is allowed; a NEW answer to a
    retired question is still refused (the test above).
  */
  it('lets a partner edit an answer to a question retired since, alongside other answers', async () => {
    const reference = await aDraft();
    const retiring = await aQuestion(false);
    const active = await aQuestion(true);

    await service.saveFaqAnswers(partner(), reference, {
      answers: [
        { questionId: retiring, answerAr: 'قبل', answerEn: null, answerDe: null },
      ],
    });
    await db.execute(
      sql`UPDATE property_faq_questions SET is_active = false WHERE id = ${retiring}::uuid`,
    );

    await service.saveFaqAnswers(partner(), reference, {
      answers: [
        { questionId: retiring, answerAr: 'بعد', answerEn: null, answerDe: null },
        { questionId: active, answerAr: 'نعم', answerEn: null, answerDe: null },
      ],
    });

    const { questions } = await service.faqForOwn(partner(), reference);

    expect(questions.find((q) => q.id === retiring)?.answerAr).toBe('بعد');
    expect(questions.find((q) => q.id === active)?.answerAr).toBe('نعم');
  });

  /*
    Emptying an answer removes it (audit 2026-10-04). The form left an emptied box out of the
    payload and the API only upserted, so «تم الحفظ» appeared and the old answer stayed public.
  */
  it('removes an answer the partner cleared', async () => {
    const reference = await aDraft();
    const questionId = await aQuestion(false);

    await service.saveFaqAnswers(partner(), reference, {
      answers: [{ questionId, answerAr: 'خطأ', answerEn: null, answerDe: null }],
    });
    await service.saveFaqAnswers(partner(), reference, {
      answers: [],
      cleared: [questionId],
    });

    const { questions } = await service.faqForOwn(partner(), reference);

    expect(questions.find((q) => q.id === questionId)?.answerAr ?? null).toBeNull();
  });

  /* The opposite control: clearing names this listing's answer and nobody else's. */
  it('clears nothing on another partner’s listing', async () => {
    const reference = await aDraft();
    const questionId = await aQuestion(false);

    await service.saveFaqAnswers(partner(), reference, {
      answers: [{ questionId, answerAr: 'باقية', answerEn: null, answerDe: null }],
    });

    await expect(
      service.saveFaqAnswers(other(), reference, { answers: [], cleared: [questionId] }),
    ).rejects.toBeTruthy();

    const { questions } = await service.faqForOwn(partner(), reference);
    expect(questions.find((q) => q.id === questionId)?.answerAr).toBe('باقية');
  });
});
