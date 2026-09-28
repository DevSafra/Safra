import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type FaqQuestionCreateInput,
  type FaqQuestionUpdateInput,
  type GeneralFaqCreateInput,
  type GeneralFaqUpdateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { conflict, notFound } from '../common/errors/app-error.js';

export interface FaqQuestionRow {
  readonly id: string;
  readonly questionAr: string;
  readonly questionEn: string | null;
  readonly questionDe: string | null;
  readonly isRequired: boolean;
  readonly isActive: boolean;
  readonly position: number;
  /** Listings that have answered it — what makes retiring rather than deleting the obvious choice. */
  readonly answers: number;
}

/**
 * What the two queries below actually SELECT.
 *
 * Declared rather than cast from `Record<string, unknown>`: a record of unknowns makes every field
 * read need a `String()` around it, and `String()` over an unknown is how an object reaches a
 * screen as «[object Object]». The lint rule that forbids it is right — the fix is to say what the
 * query returns, not to silence the cast.
 */
type FaqQuestionSqlRow = {
  readonly id: string;
  readonly question_ar: string;
  readonly question_en: string | null;
  readonly question_de: string | null;
  readonly is_required: boolean;
  readonly is_active: boolean;
  readonly position: number;
  readonly answers: number;
};

type GeneralFaqSqlRow = {
  readonly id: string;
  readonly question_ar: string;
  readonly question_en: string | null;
  readonly question_de: string | null;
  readonly answer_ar: string;
  readonly answer_en: string | null;
  readonly answer_de: string | null;
  readonly is_active: boolean;
  readonly position: number;
};

export interface GeneralFaqRow {
  readonly id: string;
  readonly questionAr: string;
  readonly questionEn: string | null;
  readonly questionDe: string | null;
  readonly answerAr: string;
  readonly answerEn: string | null;
  readonly answerDe: string | null;
  readonly isActive: boolean;
  readonly position: number;
}

/**
 * الأسئلة الشائعة — the two FAQs on a property page (Bashar, 2026-09-28).
 *
 * ## Why this reuses `CATALOGUE_MANAGE` rather than minting a permission
 *
 * `catalogue.controller.ts` warns that reusing a permission because two screens LOOK alike is how
 * authority quietly widens, so the question is whether this is the same AUTHORITY — and it is.
 * Both are platform-wide reference content, authored by a super admin, read by every listing, and
 * a change to either reshapes what thousands of pages show. Bashar's words were «created from the
 * super admin», which is precisely who holds `CATALOGUE_MANAGE`. A second permission over the same
 * actor and the same blast radius would be a distinction nobody could act on.
 *
 * ## Retiring and deleting are different acts, and both are offered
 *
 * The same pair كتالوج المنصّة draws. `isActive = false` stops a question being ASKED of new
 * listings and leaves every answer already given rendering on its page — right for a question that
 * has served its purpose. Deletion is right for a question added by mistake, and it is refused the
 * moment any listing has answered it, with the count, so retiring is understood as the alternative
 * rather than guessed at.
 */
@Injectable()
export class FaqService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /* ── Property questions ───────────────────────────────────────────────── */

  /**
   * Every question, retired ones included, with how many listings have answered each.
   *
   * The console shows retired questions — an operator who retired one needs to see that it is
   * retired, and a list that hides them is a list where the same question gets added twice.
   */
  async questions(): Promise<FaqQuestionRow[]> {
    const rows = await this.db.execute<FaqQuestionSqlRow>(sql`
      SELECT q.id, q.question_ar, q.question_en, q.question_de,
             q.is_required, q.is_active, q.position,
             (SELECT count(*) FROM property_faq_answers a
               WHERE a.question_id = q.id AND a.deleted_at IS NULL) AS answers
        FROM property_faq_questions q
       WHERE q.deleted_at IS NULL
       ORDER BY q.is_active DESC, q.position, q.created_at
    `);

    return rows.rows.map((r) => ({
      id: r.id,
      questionAr: r.question_ar,
      questionEn: r.question_en,
      questionDe: r.question_de,
      isRequired: r.is_required,
      isActive: r.is_active,
      position: Number(r.position),
      answers: Number(r.answers),
    }));
  }

  async createQuestion(
    actor: AccessTokenClaims | undefined,
    input: FaqQuestionCreateInput,
  ): Promise<{ id: string }> {
    const id = await this.db.transaction(async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO property_faq_questions
          (question_ar, question_en, question_de, is_required, position)
        VALUES (${input.questionAr}, ${input.questionEn ?? null}, ${input.questionDe ?? null},
                ${input.isRequired}, ${input.position})
        RETURNING id
      `);

      const newId = inserted.rows[0]?.id ?? '';

      await this.record(tx, actor, 'faq_question.created', 'faq_question', undefined, {
        id: newId,
        questionAr: input.questionAr,
        isRequired: input.isRequired,
      });

      return newId;
    });

    return { id };
  }

  async updateQuestion(
    actor: AccessTokenClaims | undefined,
    id: string,
    input: FaqQuestionUpdateInput,
  ): Promise<{ id: string }> {
    const before = await this.question(id);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE property_faq_questions SET
          question_ar = ${input.questionAr ?? before.questionAr},
          question_en = ${input.questionEn === undefined ? before.questionEn : input.questionEn},
          question_de = ${input.questionDe === undefined ? before.questionDe : input.questionDe},
          is_required = ${input.isRequired ?? before.isRequired},
          is_active   = ${input.isActive ?? before.isActive},
          position    = ${input.position ?? before.position},
          updated_at  = now()
        WHERE id = ${id} AND deleted_at IS NULL
      `);

      await this.record(
        tx,
        actor,
        'faq_question.updated',
        'faq_question',
        {
          questionAr: before.questionAr,
          isRequired: before.isRequired,
          isActive: before.isActive,
        },
        {
          id,
          questionAr: input.questionAr ?? before.questionAr,
          isRequired: input.isRequired ?? before.isRequired,
          isActive: input.isActive ?? before.isActive,
        },
      );
    });

    return { id };
  }

  /**
   * Deleted only while nothing has answered it.
   *
   * The refusal carries the count, so an operator learns that retiring is the move rather than
   * meeting a foreign-key error and guessing.
   */
  async deleteQuestion(
    actor: AccessTokenClaims | undefined,
    id: string,
  ): Promise<{ id: string }> {
    const before = await this.question(id);

    if (before.answers > 0)
      throw conflict(ERROR.CATALOGUE_IN_USE, { count: before.answers });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE property_faq_questions SET deleted_at = now(), updated_at = now()
         WHERE id = ${id} AND deleted_at IS NULL
      `);

      await this.record(tx, actor, 'faq_question.deleted', 'faq_question', {
        id,
        questionAr: before.questionAr,
      });
    });

    return { id };
  }

  /* ── General entries ──────────────────────────────────────────────────── */

  async generalEntries(): Promise<GeneralFaqRow[]> {
    const rows = await this.db.execute<GeneralFaqSqlRow>(sql`
      SELECT id, question_ar, question_en, question_de,
             answer_ar, answer_en, answer_de, is_active, position
        FROM general_faq_entries
       WHERE deleted_at IS NULL
       ORDER BY is_active DESC, position, created_at
    `);

    return rows.rows.map((r) => ({
      id: r.id,
      questionAr: r.question_ar,
      questionEn: r.question_en,
      questionDe: r.question_de,
      answerAr: r.answer_ar,
      answerEn: r.answer_en,
      answerDe: r.answer_de,
      isActive: r.is_active,
      position: Number(r.position),
    }));
  }

  async createGeneral(
    actor: AccessTokenClaims | undefined,
    input: GeneralFaqCreateInput,
  ): Promise<{ id: string }> {
    const id = await this.db.transaction(async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO general_faq_entries
          (question_ar, question_en, question_de, answer_ar, answer_en, answer_de, position)
        VALUES (${input.questionAr}, ${input.questionEn ?? null}, ${input.questionDe ?? null},
                ${input.answerAr}, ${input.answerEn ?? null}, ${input.answerDe ?? null},
                ${input.position})
        RETURNING id
      `);

      const newId = inserted.rows[0]?.id ?? '';

      await this.record(tx, actor, 'faq_general.created', 'faq_general', undefined, {
        id: newId,
        questionAr: input.questionAr,
      });

      return newId;
    });

    return { id };
  }

  async updateGeneral(
    actor: AccessTokenClaims | undefined,
    id: string,
    input: GeneralFaqUpdateInput,
  ): Promise<{ id: string }> {
    const before = await this.generalEntry(id);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE general_faq_entries SET
          question_ar = ${input.questionAr ?? before.questionAr},
          question_en = ${input.questionEn === undefined ? before.questionEn : input.questionEn},
          question_de = ${input.questionDe === undefined ? before.questionDe : input.questionDe},
          answer_ar   = ${input.answerAr ?? before.answerAr},
          answer_en   = ${input.answerEn === undefined ? before.answerEn : input.answerEn},
          answer_de   = ${input.answerDe === undefined ? before.answerDe : input.answerDe},
          is_active   = ${input.isActive ?? before.isActive},
          position    = ${input.position ?? before.position},
          updated_at  = now()
        WHERE id = ${id} AND deleted_at IS NULL
      `);

      await this.record(
        tx,
        actor,
        'faq_general.updated',
        'faq_general',
        { questionAr: before.questionAr, isActive: before.isActive },
        {
          id,
          questionAr: input.questionAr ?? before.questionAr,
          isActive: input.isActive ?? before.isActive,
        },
      );
    });

    return { id };
  }

  /** Nothing references a general entry, so it deletes outright — no in-use refusal to make. */
  async deleteGeneral(
    actor: AccessTokenClaims | undefined,
    id: string,
  ): Promise<{ id: string }> {
    const before = await this.generalEntry(id);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE general_faq_entries SET deleted_at = now(), updated_at = now()
         WHERE id = ${id} AND deleted_at IS NULL
      `);

      await this.record(tx, actor, 'faq_general.deleted', 'faq_general', {
        id,
        questionAr: before.questionAr,
      });
    });

    return { id };
  }

  /* ── Internals ────────────────────────────────────────────────────────── */

  private async question(id: string): Promise<FaqQuestionRow> {
    const found = (await this.questions()).find((q) => q.id === id);

    if (!found) throw notFound(ERROR.FAQ_NOT_FOUND);

    return found;
  }

  private async generalEntry(id: string): Promise<GeneralFaqRow> {
    const found = (await this.generalEntries()).find((e) => e.id === id);

    if (!found) throw notFound(ERROR.FAQ_NOT_FOUND);

    return found;
  }

  private async record(
    tx: unknown,
    actor: AccessTokenClaims | undefined,
    action: string,
    subjectType: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorUserId: actor?.sub,
        actorRole: actor?.role,
        action,
        subjectType,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      },
      tx as Database,
    );
  }
}
