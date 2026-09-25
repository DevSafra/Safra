import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { PropertiesService } from './properties.service.js';

/**
 * A published listing and its missing DESCRIPTION — the second narrow §8.1 exception.
 *
 * ## Why it exists
 *
 * الإعلانات reports «بلا وصف بالعربية» as a gap. Until this, a partner could not close it: §8.1
 * freezes every structural field on a published listing, the description is one of them, and the
 * link to fix it landed on a page with no description form because `PropertyEditor` does not
 * render for a frozen listing. Reporting a gap while forbidding the partner to close it is worse
 * than not reporting it at all.
 *
 * ## The argument, which is the coordinate one
 *
 * Bashar approved that version on 2026-09-24 — «allowing published listings that currently have no
 * coordinates to add coordinates later without forcing a support workflow». §8.1 freezes what
 * SAFRA VERIFIED: the address, the city, the classification. Marketing copy is not among them.
 * Writing words where there were none contradicts nothing an inspector checked; rewriting existing
 * ones is a different claim and stays refused.
 *
 * ## What is asserted
 *
 * - WRITING into an empty language is allowed on a published listing.
 * - CHANGING one that already has words is refused, in every language.
 * - CLEARING one is a change too, and stays refused.
 * - Nothing may ride along: a patch that also touches the name falls back to the ordinary rule.
 * - A patch that writes a new Arabic description AND rewrites an existing English one is refused
 *   entirely — the exception cannot be used to smuggle an edit through beside a completion.
 *
 * Every case was watched to FAIL against a mutation that widened the exception.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a published listing and its missing description', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new PropertiesService(db, new AuditService(db));

  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** A published listing owned by a real user, with its descriptions set as the case needs. */
  async function aPublishedListing(descriptions: {
    ar: string | null;
    en: string | null;
  }) {
    const rows = await db.execute<{
      reference: string;
      partner_id: string;
      user_id: string;
    }>(sql`
      SELECT p.reference, p.partner_id, pe.user_id
      FROM properties p
      JOIN partner_employees pe ON pe.partner_id = p.partner_id
      WHERE p.status = 'published' AND p.deleted_at IS NULL AND pe.status = 'active'
      ORDER BY p.reference
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw new Error('no published listing with an owning user to test against');

    await db.execute(sql`
      UPDATE properties
      SET description_ar = ${descriptions.ar}, description_en = ${descriptions.en}
      WHERE reference = ${row.reference}
    `);

    return row;
  }

  /* `permissions`, not `capabilities`, and the constant rather than a hand-typed string. */
  const partner = (row: { partner_id: string; user_id: string }): AccessTokenClaims => ({
    sub: row.user_id,
    role: 'partner',
    permissions: [P.PROPERTY_MANAGE_OWN, P.PRICE_UPDATE],
    locale: 'ar',
    totpEnabled: true,
    partnerId: row.partner_id,
  });

  it('lets a partner describe a published listing that has no description', async () => {
    const row = await aPublishedListing({ ar: null, en: null });

    await service.update(partner(row), row.reference, {
      description: { ar: 'بيت دمشقي بفناء داخلي وبئر قديمة.' },
    });

    const [after] = await db
      .execute<{ description_ar: string }>(
        sql`SELECT description_ar FROM properties WHERE reference = ${row.reference}`,
      )
      .then((r) => r.rows);

    expect(after?.description_ar).toBe('بيت دمشقي بفناء داخلي وبئر قديمة.');
  });

  it('treats a description of only whitespace as no description', async () => {
    /* `'   '` is what an emptied box stores. It is a gap, not a description. */
    const row = await aPublishedListing({ ar: '   ', en: null });

    await service.update(partner(row), row.reference, {
      description: { ar: 'وصف حقيقي.' },
    });

    const [after] = await db
      .execute<{ description_ar: string }>(
        sql`SELECT description_ar FROM properties WHERE reference = ${row.reference}`,
      )
      .then((r) => r.rows);

    expect(after?.description_ar).toBe('وصف حقيقي.');
  });

  it('refuses to CHANGE a description that already has words', async () => {
    const row = await aPublishedListing({ ar: 'الوصف الأصلي.', en: null });

    expect(
      codeOf(
        await service
          .update(partner(row), row.reference, { description: { ar: 'وصف آخر تمامًا.' } })
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
  });

  it('refuses to CLEAR a description, which is a change and not a completion', async () => {
    const row = await aPublishedListing({ ar: 'الوصف الأصلي.', en: null });

    expect(
      codeOf(
        await service
          .update(partner(row), row.reference, { description: { ar: '' } })
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
  });

  /**
   * A patch that writes NOTHING is not a completion.
   *
   * `{ ar: '' }` against a listing that already has no description changes nothing, so the
   * exception must not rescue it — the ordinary freeze applies and the refusal is the honest
   * answer. Narrow: the «writes something» clause is only load-bearing in exactly this case,
   * because every other clearing attempt is already refused by the stored value being non-blank.
   * Found by mutation — removing that clause left every other test in this file green.
   */
  it('refuses a patch that clears a description which was already empty', async () => {
    const row = await aPublishedListing({ ar: null, en: null });

    expect(
      codeOf(
        await service
          .update(partner(row), row.reference, { description: { ar: '' } })
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
  });

  /**
   * An EMPTY patch is not a completion either.
   *
   * `{ description: {} }` names the field and writes nothing. Every other clearing attempt is
   * already refused because the stored value is not blank, so this is the one case the «writes
   * something» clause is load-bearing for — and without it the request would succeed against a
   * frozen listing while changing nothing, which is the freeze quietly not applying.
   *
   * Found by mutation: removing that clause left all eight other cases in this file green.
   */
  it('refuses a description patch that names the field and writes nothing', async () => {
    const row = await aPublishedListing({ ar: null, en: null });

    expect(
      codeOf(
        await service
          .update(partner(row), row.reference, { description: {} })
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
  });

  /**
   * The smuggling case, and the reason the exception is per LANGUAGE rather than per field.
   *
   * A patch writing a new Arabic description beside a rewritten English one is half completion and
   * half edit. Allowing it would let any partner rewrite existing copy by attaching an empty
   * language to the request — the exception must refuse the whole patch, not the half it likes.
   */
  it('refuses a patch that rewrites one language while filling another', async () => {
    const row = await aPublishedListing({ ar: null, en: 'The original English copy.' });

    expect(
      codeOf(
        await service
          .update(partner(row), row.reference, {
            description: { ar: 'وصف جديد.', en: 'Something else entirely.' },
          })
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
  });

  it('refuses a patch that carries a name change beside the description', async () => {
    const row = await aPublishedListing({ ar: null, en: null });

    expect(
      codeOf(
        await service
          .update(partner(row), row.reference, {
            description: { ar: 'وصف جديد.' },
            name: { ar: 'اسم مختلف' },
          })
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
  });

  it('still refuses an ordinary structural change on a published listing', async () => {
    const row = await aPublishedListing({ ar: null, en: null });

    expect(
      codeOf(
        await service
          .update(partner(row), row.reference, { name: { ar: 'اسم مختلف' } })
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
  });
});
