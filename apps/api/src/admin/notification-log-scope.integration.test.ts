import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { Env } from '../config/env.js';
import { NotificationRedriveService } from '../notifications/notification-redrive.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { MessagingService } from './messaging.service.js';

/**
 * The delivery log, read by a member scoped to one city.
 *
 * A notice about a dispute carries `dispute_id` and, for the customer's copy, `customer_profile_id`
 * and nothing else. Its city was taken from the booking or the partner the NOTICE named, so it came
 * out NULL, which the scope reads as platform-level: every scoped member read it and could re-drive
 * it. The counters above the list were not scoped at all. Each case is asked from both sides, so a
 * read that refused everybody would fail the opposite control.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the delivery log under a city scope', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /* Accepts a re-drive without sending: the subject is who may ask, not the mail. */
  const notifier = {
    reenqueue: () => Promise.resolve(true),
  } as unknown as NotificationService;
  const env = {
    APP_URL: 'http://localhost:3000',
    PARTNER_URL: 'http://localhost:3002',
  } as unknown as Env;
  const messaging = new MessagingService(db, new AuditService(db), notifier, env);
  const redrive = new NotificationRedriveService(db, env, notifier);

  let home = '';
  let away = '';
  let disputeReference = '';
  let notificationId = '';

  const scopedTo = (
    cityId: string,
    outside: 'none' | 'read_only' = 'none',
  ): AccessTokenClaims =>
    ({
      sub: '00000000-0000-0000-0000-000000000000',
      role: 'support_agent',
      permissions: [],
      locale: 'ar',
      scope: { kind: 'cities', cityIds: [cityId], outside },
    }) as unknown as AccessTokenClaims;

  const failedEmails = async (actor: AccessTokenClaims) =>
    (await messaging.notificationCounters(actor)).byChannel['email']?.['failed'] ?? 0;

  /** Seeds the notice and reports what the counter read for each side BEFORE it existed. */
  async function seed(): Promise<{ home: number; away: number }> {
    const booking = await db.execute<{
      id: string;
      partner_id: string;
      customer_profile_id: string;
      city_id: string;
    }>(sql`
      SELECT id, partner_id, customer_profile_id, city_id::text AS city_id FROM bookings
      WHERE deleted_at IS NULL AND customer_profile_id IS NOT NULL AND city_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    `);
    const row = booking.rows[0];

    home = row?.city_id ?? '';
    away =
      (
        await db.execute<{ id: string }>(sql`
          SELECT id::text AS id FROM cities WHERE id <> ${home}::uuid LIMIT 1
        `)
      ).rows[0]?.id ?? '';

    const before = {
      home: await failedEmails(scopedTo(home)),
      away: await failedEmails(scopedTo(away)),
    };

    const dispute = await db.execute<{ id: string; reference: string }>(sql`
      INSERT INTO disputes (booking_id, partner_id, customer_profile_id, kind, status, title)
      VALUES (${row?.id}::uuid, ${row?.partner_id}::uuid, ${row?.customer_profile_id}::uuid,
              'not_as_described', 'open', 'delivery log scope')
      RETURNING id, reference
    `);

    disputeReference = dispute.rows[0]?.reference ?? '';

    /* The customer's copy of a closure: the dispute and the profile, no booking, no partner. */
    const notice = await db.execute<{ id: string }>(sql`
      INSERT INTO notifications (channel, template_key, locale, status, dispute_id,
                                 customer_profile_id, failure_reason)
      VALUES ('email', 'dispute.resolved', 'ar', 'failed', ${dispute.rows[0]?.id}::uuid,
              ${row?.customer_profile_id}::uuid, 'test')
      RETURNING id
    `);

    notificationId = notice.rows[0]?.id ?? '';

    return before;
  }

  beforeEach(() => harness.begin());
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const listed = async (actor: AccessTokenClaims) =>
    (
      await messaging.notifications({ limit: 25, page: 1, q: disputeReference, actor })
    ).items.map((item) => item.id);

  it('lists a dispute notice to its own city and to nobody else', async () => {
    await seed();

    expect(await listed(scopedTo(home))).toEqual([notificationId]);
    expect(await listed(scopedTo(away))).toEqual([]);
  });

  it('counts a dispute notice in its own city’s summary and in nobody else’s', async () => {
    const before = await seed();

    expect(await failedEmails(scopedTo(home))).toBe(before.home + 1);
    expect(await failedEmails(scopedTo(away))).toBe(before.away);
  });

  it('refuses a re-drive from outside the city, as if the notice were not there', async () => {
    await seed();

    await expect(redrive.redriveOne(notificationId, scopedTo(away))).resolves.toBeNull();
    /* The opposite control: inside the city the same id is found and acted on. */
    await expect(
      redrive.redriveOne(notificationId, scopedTo(home)),
    ).resolves.not.toBeNull();
  });

  /*
    Read-only outside the member's cities means LOOK, not act (security pass, 2026-10-06). The notice
    is visible to them, so the refusal is a 403 rather than a pretended absence, and the row is left
    exactly as it was.
  */
  it('refuses a re-drive to a member who may only read the other city', async () => {
    await seed();

    await expect(
      redrive.redriveOne(notificationId, scopedTo(away, 'read_only')),
    ).rejects.toMatchObject({ status: 403 });

    const row = await db.execute<{ status: string }>(sql`
      SELECT status::text FROM notifications WHERE id = ${notificationId}::uuid
    `);

    expect(row.rows[0]?.status, 'nothing was re-sent').toBe('failed');
  });
});
