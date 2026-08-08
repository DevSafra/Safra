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
    const queue = await review.pendingPartners(50);

    expect(queue.length).toBeGreaterThan(0);

    for (const partner of queue) {
      expect(Array.isArray(partner.documents)).toBe(true);
      expect(typeof partner.city.slug).toBe('string');
    }
  });

  /** And the seeded partner's document resolves through the relation. */
  it('resolves a partner’s uploaded documents', async () => {
    const queue = await review.pendingPartners(5000);
    const mine = queue.find((p) => p.reference === reference);

    expect(mine?.documents).toHaveLength(1);
    expect(mine?.documents[0]?.kind).toBe('commercial_register');
    expect(mine?.city.slug).toBe('damascus');
  });

  it('lists pending properties without throwing', async () => {
    await expect(review.pendingProperties(10)).resolves.toBeInstanceOf(Array);
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
