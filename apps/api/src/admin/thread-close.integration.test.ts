import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { MessagingService } from './messaging.service.js';
import { SupportService } from '../support/support.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { createInlineMailQueue } from '../queue/queue.testing.js';
import type { MailService } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Ending a thread from the console — «إنهاء المحادثة».
 *
 * ## The gap (الرسائل review, 2026-08-28)
 *
 * `conversations.closed_at` had exactly one writer, `SupportService.close`, and it is asker-only.
 * So a question answered on the phone, or a ticket opened twice, stayed open for ever — and the
 * الرسائل badge counts open threads with something unread, which is the number an agent works
 * down. The queue could not be emptied by the people whose queue it is.
 *
 * ## Watched to fail
 *
 * Each case here was run against the code without the fix, or with the specific line removed:
 * dropping the `unread_for_staff = 0` leaves a closed thread still counted; dropping the
 * already-closed guard writes a second audit row and a second email for a double click; skipping
 * `notifyAskerOfClose` leaves the person waiting for an answer that is not coming.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const ASKED = 'The lift has been out of service since we arrived on Tuesday.';

describeIfDb('closing a thread from the console', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sentMail: { to: string; subject: string; text: string }[] = [];
  const mail = {
    send: (message: { to: string; subject: string; text: string }) => {
      sentMail.push(message);

      return Promise.resolve();
    },
  } as unknown as MailService;

  const mailQueue = createInlineMailQueue();
  const notifications = new NotificationService(db, mail, mailQueue.queue);

  mailQueue.autoRun = (job) =>
    notifications.deliver(job.notificationId, job.templateKey, job.mail);

  const messaging = new MessagingService(db, new AuditService(db), notifications, {
    APP_URL: 'http://localhost:3000',
    PARTNER_URL: 'http://localhost:3002',
  } as unknown as Env);
  const support = new SupportService(db);

  let customerProfileId = '';
  let customerUserId = '';
  let staffUserId = '';

  const customer = (): AccessTokenClaims => ({
    sub: customerUserId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId,
  });

  const agent = (): AccessTokenClaims => ({
    sub: staffUserId,
    role: 'support_agent',
    permissions: [],
    locale: 'ar',
  });

  /** The thread's own row, read straight from the table rather than through the service. */
  const rowOf = async (reference: string) =>
    (
      await db.execute<{ closed: boolean; unread_for_staff: number }>(sql`
        SELECT (closed_at IS NOT NULL) AS closed, unread_for_staff
        FROM conversations WHERE reference = ${reference}
      `)
    ).rows[0];

  const auditCount = async (reference: string) =>
    Number(
      (
        await db.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM audit_log
          WHERE action = 'conversation.closed'
            AND after->>'reference' = ${reference}
        `)
      ).rows[0]?.n ?? 0,
    );

  const noticeCount = async () =>
    Number(
      (
        await db.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM notifications
          WHERE template_key = 'support.closed'
            AND customer_profile_id = ${customerProfileId}::uuid
        `)
      ).rows[0]?.n ?? 0,
    );

  beforeEach(async () => {
    await harness.begin();
    await seed();
    sentMail.length = 0;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('ends the thread, clears the unread counter and records who did it', async () => {
    const ticket = await support.open(customer(), ASKED);

    /* The control: it is open and counted before the close. */
    expect(await rowOf(ticket.reference)).toMatchObject({
      closed: false,
      unread_for_staff: 1,
    });

    await expect(messaging.close(agent(), ticket.reference)).resolves.toEqual({
      closed: true,
    });

    /*
      Both, in one assertion, because closing without zeroing the counter satisfies the letter of
      the gap and not its point: the thread would read as closed and still be counted as waiting.
    */
    expect(await rowOf(ticket.reference)).toMatchObject({
      closed: true,
      unread_for_staff: 0,
    });
    expect(await auditCount(ticket.reference)).toBe(1);
  });

  it('tells the person who was waiting, in their own language', async () => {
    const ticket = await support.open(customer(), ASKED);

    await messaging.close(agent(), ticket.reference);

    expect(await noticeCount()).toBe(1);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]?.subject).toContain(ticket.reference);
    /* The link goes where the customer can actually read it. */
    expect(sentMail[0]?.text).toContain(
      `http://localhost:3000/ar/account/support/${ticket.reference}`,
    );
  });

  /**
   * A second press is an ordinary thing to do to a page that can be reloaded. It must change
   * nothing — not the row, not the audit trail, and above all not send a second email saying the
   * thread was ended again.
   */
  it('does nothing on a second close, and says so', async () => {
    const ticket = await support.open(customer(), ASKED);

    await messaging.close(agent(), ticket.reference);
    sentMail.length = 0;

    await expect(messaging.close(agent(), ticket.reference)).resolves.toEqual({
      closed: false,
    });

    expect(await auditCount(ticket.reference)).toBe(1);
    expect(await noticeCount()).toBe(1);
    expect(sentMail).toHaveLength(0);
  });

  /**
   * The screen has to know, or it goes on offering a reply box over a thread whose reply endpoint
   * refuses everything — the control that «does nothing» this codebase keeps producing.
   */
  it('reports the closed state to the screen, and refuses a reply', async () => {
    const ticket = await support.open(customer(), ASKED);

    const before = await messaging.thread(ticket.reference, agent());

    expect(before.closed).toBe(false);

    await messaging.close(agent(), ticket.reference);

    const after = await messaging.thread(ticket.reference, agent());

    expect(after.closed).toBe(true);
    /* The messages stay readable — closing is not deleting. */
    expect(after.messages).toHaveLength(1);

    await expect(
      messaging.reply(agent(), ticket.reference, { body: 'Late.', internal: false }),
    ).rejects.toMatchObject({
      response: { code: ERROR.CONVERSATION_NOT_FOUND_OR_CLOSED },
    });
  });

  /** A reference nobody holds answers as absent, never as «closed». */
  it('refuses a reference that does not exist', async () => {
    await expect(messaging.close(agent(), 'CNV-000000')).rejects.toMatchObject({
      response: { code: ERROR.CONVERSATION_NOT_FOUND_OR_CLOSED },
    });
  });

  async function seed(): Promise<void> {
    const made = await db.execute<{
      customer_profile_id: string;
      customer_user_id: string;
      staff_user_id: string;
    }>(sql`
      WITH cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('close-c-' || gen_random_uuid() || '@safra.test', '+963900000070',
                'customer', 'active', 'ar')
        RETURNING id
      ), su AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('close-s-' || gen_random_uuid() || '@safra.test', '+963900000071',
                'support_agent', 'active', 'ar')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest, preferred_locale)
        SELECT cu.id, 'صاحب الطلب',
               'close-c-' || gen_random_uuid() || '@safra.test', '+963900000070', false, 'ar'
        FROM cu RETURNING id, user_id
      )
      SELECT cp.id AS customer_profile_id, cp.user_id AS customer_user_id,
             su.id AS staff_user_id
      FROM cp, su
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    customerProfileId = row.customer_profile_id;
    customerUserId = row.customer_user_id;
    staffUserId = row.staff_user_id;
  }
});
