import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { ReviewService } from './review.service.js';
import { SanctionsService } from '../sanctions/sanctions.service.js';

/**
 * The §8.1 verification queues, against a REAL PostgreSQL.
 *
 * This file exists because of a defect that shipped and sat undetected: the
 * pending-PARTNERS queue returned a 500 on every call from the day it was written.
 * Drizzle needs both halves of a relation declared, and only the `many()` side was —
 * so the relational query threw "not enough information to infer relation" before it
 * ever reached the database.
 *
 * Nothing caught it because nothing called it. The endpoint had no consumer until the
 * admin console was built, and a queue nobody opens cannot be seen to be broken. The
 * lesson is in the test rather than the comment: this asserts the queries EXECUTE and
 * return their nested relations, which is the part a type-check cannot prove.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('verification queues', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  let db: Database;
  let review: ReviewService;
  let reference: string;

  beforeEach(async () => {
    await harness.begin();

    db = harness.db;

    /**
     * A real SanctionsService. These tests only exercise the QUEUES, which never
     * screen — but constructing the real thing means a change to its shape breaks
     * here rather than silently at runtime.
     */
    review = new ReviewService(db, new AuditService(db), new SanctionsService(db));

    reference = await createPendingPartnerWithDocument(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * The regression. Before the fix this THREW rather than returning rows.
   *
   * Asserted over whatever the queue returns rather than by hunting for the partner
   * this test seeded: the queue is oldest-first and capped, so on a database with
   * any history the seeded row is not on the first page. What matters is that the
   * query executes and that its nested relations resolve — which is precisely what
   * was broken.
   */
  it('lists pending partners with their documents and city resolved', async () => {
    const queue = await review.pendingPartners({ page: 1, limit: 50 });

    expect(queue.items.length).toBeGreaterThan(0);

    for (const partner of queue.items) {
      expect(Array.isArray(partner.documents)).toBe(true);
      expect(typeof partner.city.slug).toBe('string');
    }
  });

  /**
   * And the seeded partner's document resolves through the relation.
   *
   * Walks the PAGES rather than asking for one big one. The queue became paged on 2026-08-20 and
   * `limit` is capped at 100 by `pageQuerySchema`, so the old `pendingPartners(5000)` is no longer
   * expressible — which is the point of the change: nothing can ask for the whole queue at once.
   */
  it('resolves a partner’s uploaded documents', async () => {
    let mine: { documents: { kind: string }[]; city: { slug: string } } | undefined;

    for (let page = 1; page <= 40 && !mine; page += 1) {
      const queue = await review.pendingPartners({ page, limit: 100 });

      if (queue.items.length === 0) break;

      mine = queue.items.find((p) => p.reference === reference);
    }

    expect(mine?.documents).toHaveLength(1);
    expect(mine?.documents[0]?.kind).toBe('commercial_register');
    expect(mine?.city.slug).toBe('damascus');
  });

  it('lists pending properties without throwing', async () => {
    const queue = await review.pendingProperties({ page: 1, limit: 10 });

    expect(Array.isArray(queue.items)).toBe(true);
  });

  /**
   * The queue is PAGED, and the total describes the whole queue rather than the page.
   *
   * The regression this suite now guards: `pendingPartners` took `limit = 50` and returned a bare
   * array, so 477 of 527 pending partners were unreachable through the console and no number on the
   * screen admitted it.
   */
  it('pages the partner queue and reports a total beyond the page', async () => {
    const first = await review.pendingPartners({ page: 1, limit: 5 });

    expect(first.items).toHaveLength(5);
    expect(first.page).toBe(1);
    expect(first.total).toBeGreaterThan(5);
    expect(first.pages).toBeGreaterThan(1);

    const second = await review.pendingPartners({ page: 2, limit: 5 });
    const overlap = second.items.filter((row) =>
      first.items.some((other) => other.reference === row.reference),
    );

    expect(overlap, 'page 2 must not repeat page 1').toEqual([]);
  });

  /** A page past the end is an empty queue, not an error — the reader types the number. */
  it('answers a page past the end with an empty page', async () => {
    const far = await review.pendingPartners({ page: 90_000, limit: 25 });

    expect(far.items).toEqual([]);
    expect(far.total).toBeGreaterThan(0);
  });

  /** The §9.2 counters the dashboard renders. */
  it('returns the attention counters', async () => {
    const counters = await review.attentionCounts();

    expect(counters).toHaveProperty('partners_pending_verification');
    expect(counters).toHaveProperty('properties_pending_review');
    expect(counters).toHaveProperty('bookings_sla_expiring_within_30m');
    expect(counters.partners_pending_verification).toBeGreaterThan(0);
  });
});

async function createPendingPartnerWithDocument(db: Database): Promise<string> {
  const id = randomUUID();
  const userId = randomUUID();
  const email = `queue-test-${id.slice(0, 8)}@safra.test`;

  await db.execute(sql`
    INSERT INTO users (id, email, role) VALUES (${userId}::uuid, ${email}, 'partner')`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name,
                          city_id, address, phone, email)
    SELECT ${id}::uuid, ${userId}::uuid, pt.id, 'Queue Test LLC', 'Queue Test', c.id,
           'Addr', '+963900000030', ${email}
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus' LIMIT 1`);

  await db.execute(sql`
    INSERT INTO partner_documents (partner_id, kind, file_key, file_name)
    VALUES (${id}::uuid, 'commercial_register',
            ${`partners/${id}/documents/${randomUUID()}.pdf`}, 'register.pdf')`);

  const rows = await db.execute<{ reference: string }>(
    sql`SELECT reference FROM partners WHERE id = ${id}::uuid`,
  );

  return rows.rows[0]?.reference ?? '';
}
