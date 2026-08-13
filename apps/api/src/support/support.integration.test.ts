import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { SupportService } from './support.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * الدعم against a real PostgreSQL.
 *
 * The behaviour worth proving is all about who can see what: a ticket is a row in a table staff also
 * read, in a thread that can carry INTERNAL notes, reachable by a sequential reference. Every test here
 * is about a boundary rather than about the happy path.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const USER_ID = '99994444-0000-0000-0000-0000000000d1';
const PROFILE_ID = '99994444-0000-0000-0000-0000000000d2';
const OTHER_USER_ID = '99994444-0000-0000-0000-0000000000d3';
const OTHER_PROFILE_ID = '99994444-0000-0000-0000-0000000000d4';
const PARTNER_USER_ID = '99994444-0000-0000-0000-0000000000d5';
const PARTNER_ID = '99994444-0000-0000-0000-0000000000d6';

const customer = (profileId = PROFILE_ID, sub = USER_ID): AccessTokenClaims => ({
  sub,
  role: 'customer',
  permissions: [],
  locale: 'ar',
  customerProfileId: profileId,
});

const partner: AccessTokenClaims = {
  sub: PARTNER_USER_ID,
  role: 'partner',
  permissions: [],
  locale: 'ar',
  partnerId: PARTNER_ID,
};

/** Staff carry neither owning id — they have the console's own service. */
const staff: AccessTokenClaims = {
  sub: USER_ID,
  role: 'super_admin',
  permissions: [],
  locale: 'ar',
};

const LONG = 'The heating in the apartment did not work for two nights.';

describeIfDb('SupportService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let support: SupportService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    support = new SupportService(db);
    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ─── Opening ───────────────────────────────────────────────────────────────

  it('opens a ticket with its first message and puts it in front of staff', async () => {
    const thread = await support.open(customer(), LONG);

    expect(thread.reference).toMatch(/^CNV-\d+$/);
    expect(thread.closed).toBe(false);
    expect(thread.messageCount).toBe(1);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]?.sender).toBe('customer');
    expect(thread.messages[0]?.body).toBe(LONG);

    /* The console sorts its inbox by this — a ticket nobody has answered must count as unread. */
    const row = await db.execute<{ unread: number; subject: string }>(sql`
      SELECT unread_for_staff AS unread,
             (booking_id IS NULL AND dispute_id IS NULL AND partner_id IS NULL)::text AS subject
      FROM conversations WHERE reference = ${thread.reference}`);

    expect(row.rows[0]?.unread).toBe(1);
    /* Subject-less: that is what makes it a support ticket rather than a booking thread. */
    expect(row.rows[0]?.subject).toBe('true');
  });

  it('opens a partner ticket against the partner, not a customer', async () => {
    const thread = await support.open(partner, LONG);

    const row = await db.execute<{
      partner_id: string | null;
      customer_id: string | null;
    }>(sql`
      SELECT partner_id, customer_profile_id AS customer_id
      FROM conversations WHERE reference = ${thread.reference}`);

    expect(row.rows[0]?.partner_id).toBe(PARTNER_ID);
    expect(row.rows[0]?.customer_id).toBeNull();
    expect(thread.messages[0]?.sender).toBe('partner');
  });

  /**
   * A support form is the most obvious place to try to pass a phone number.
   *
   * The body is stored REDACTED and the original is not kept, which is the same rule the messaging
   * module applies to staff. `redactedCount` is returned so the sender learns it happened rather than
   * waiting for a call that cannot come.
   */
  it('redacts contact details out of the first message', async () => {
    const thread = await support.open(
      customer(),
      'Please call me on 0955 123 456 or email me at guest@example.com',
    );

    expect(thread.messages[0]?.redactedCount).toBeGreaterThan(0);
    expect(thread.messages[0]?.body).not.toContain('0955');
    expect(thread.messages[0]?.body).not.toContain('guest@example.com');

    /* And the original is nowhere in the row — "we blocked it but kept a copy" is not a rule. */
    const stored = await db.execute<{ body: string }>(sql`
      SELECT m.body FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.reference = ${thread.reference}`);

    expect(stored.rows[0]?.body).not.toContain('0955');
  });

  it('refuses an anonymous caller', async () => {
    await expect(support.open(undefined, LONG)).rejects.toMatchObject({ status: 401 });
  });

  /* Staff have the console, which shows the internal notes this service hides. */
  it('refuses a staff token, which belongs on the console side', async () => {
    await expect(support.open(staff, LONG)).rejects.toMatchObject({ status: 404 });
  });

  // ─── Reading, and not reading ──────────────────────────────────────────────

  it('lists only the caller’s own tickets', async () => {
    const mine = await support.open(customer(), LONG);
    await support.open(customer(OTHER_PROFILE_ID, OTHER_USER_ID), LONG);

    const page = await support.list(customer(), { limit: 20 });

    expect(page.items.map((t) => t.reference)).toStrictEqual([mine.reference]);
  });

  it('does not show a partner’s ticket to a customer, or the reverse', async () => {
    const theirs = await support.open(partner, LONG);

    await expect(support.thread(customer(), theirs.reference)).rejects.toMatchObject({
      status: 404,
    });

    const mine = await support.open(customer(), LONG);

    await expect(support.thread(partner, mine.reference)).rejects.toMatchObject({
      status: 404,
    });
  });

  /**
   * Somebody else's ticket is a 404, indistinguishable from one that does not exist.
   *
   * References are sequential, so any difference between the two answers is a way to count other
   * people's support requests.
   */
  it('is a 404 for another customer’s reference', async () => {
    const theirs = await support.open(customer(OTHER_PROFILE_ID, OTHER_USER_ID), LONG);

    await expect(support.thread(customer(), theirs.reference)).rejects.toMatchObject({
      status: 404,
      response: { code: 'support.ticket_not_found' },
    });
  });

  it.each(['CNV-999999', 'nonsense', '', "'; DROP TABLE messages;--"])(
    'is a 404 for the reference %j',
    async (reference) => {
      await expect(support.thread(customer(), reference)).rejects.toMatchObject({
        status: 404,
      });
    },
  );

  /**
   * INTERNAL notes are never returned. This is the single most important test in the file: staff write
   * their assessment of a complaint into the same thread the complainant can read.
   */
  it('never returns an internal staff note', async () => {
    const thread = await support.open(customer(), LONG);

    await db.execute(sql`
      INSERT INTO messages (conversation_id, sender_kind, body, redacted_count, internal)
      SELECT c.id, 'staff', 'Internal: this guest has complained three times, watch for abuse.', 0, true
      FROM conversations c WHERE c.reference = ${thread.reference}`);

    const seen = await support.thread(customer(), thread.reference);
    const serialised = JSON.stringify(seen);

    expect(serialised).not.toContain('Internal:');
    expect(serialised).not.toContain('watch for abuse');
    /* And the count agrees with what is visible, or the absence itself would be visible. */
    expect(seen.messages).toHaveLength(1);
    expect(seen.messageCount).toBe(1);
  });

  it('shows a staff reply that is not internal', async () => {
    const thread = await support.open(customer(), LONG);

    await db.execute(sql`
      INSERT INTO messages (conversation_id, sender_kind, body, redacted_count, internal)
      SELECT c.id, 'staff', 'We have contacted the partner about the heating.', 0, false
      FROM conversations c WHERE c.reference = ${thread.reference}`);

    const seen = await support.thread(customer(), thread.reference);

    expect(seen.messages).toHaveLength(2);
    expect(seen.messages[1]?.sender).toBe('staff');
  });

  // ─── Replying ─────────────────────────────────────────────────────────────

  it('adds a reply and raises the unread count rather than resetting it', async () => {
    const thread = await support.open(customer(), LONG);

    await support.reply(customer(), thread.reference, 'It is still not fixed today.');
    const after = await support.reply(customer(), thread.reference, 'Any news on this?');

    expect(after.messages).toHaveLength(3);

    const row = await db.execute<{ unread: number }>(sql`
      SELECT unread_for_staff AS unread FROM conversations WHERE reference = ${thread.reference}`);

    /* Three unanswered messages must not look like one. */
    expect(row.rows[0]?.unread).toBe(3);
  });

  it('redacts a reply too', async () => {
    const thread = await support.open(customer(), LONG);
    const after = await support.reply(
      customer(),
      thread.reference,
      'Reach me on 0955 123 456 please',
    );

    expect(after.messages[1]?.redactedCount).toBeGreaterThan(0);
    expect(after.messages[1]?.body).not.toContain('0955');
  });

  it('refuses a reply to somebody else’s ticket', async () => {
    const theirs = await support.open(customer(OTHER_PROFILE_ID, OTHER_USER_ID), LONG);

    await expect(
      support.reply(customer(), theirs.reference, 'Adding myself to this thread.'),
    ).rejects.toMatchObject({ status: 404 });
  });

  /* A closed thread is read-only: reopening it silently would hide that staff ended it. */
  it('refuses a reply to a closed ticket', async () => {
    const thread = await support.open(customer(), LONG);

    await db.execute(
      sql`UPDATE conversations SET closed_at = now() WHERE reference = ${thread.reference}`,
    );

    await expect(
      support.reply(customer(), thread.reference, 'One more thing about this.'),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'support.ticket_closed' },
    });

    /* And it still READS, so the history does not vanish when the thread ends. */
    const seen = await support.thread(customer(), thread.reference);

    expect(seen.closed).toBe(true);
    expect(seen.messages).toHaveLength(1);
  });

  // ─── Closing it yourself ──────────────────────────────────────────────────

  /**
   * The gap this closes: only staff could end a thread, so a problem that resolved itself sat in the
   * console's queue for ever and somebody eventually read it to learn it was nothing.
   */
  it('lets the asker close their own ticket', async () => {
    const thread = await support.open(customer(), LONG);

    const closed = await support.close(customer(), thread.reference);

    expect(closed.closed).toBe(true);
    /* The history stays readable — closing ends the thread, it does not hide it. */
    expect(closed.messages).toHaveLength(1);
  });

  /**
   * And the point of it: the staff queue stops counting it.
   *
   * `unread_for_staff` is what the console's inbox SORTS by, so an abandoned ticket does not merely
   * linger — it sits near the top, ahead of people who are still waiting. Closing that left the
   * counter alone would satisfy the letter of the gap and not its purpose.
   */
  it('clears the staff unread counter when the asker closes it', async () => {
    const thread = await support.open(customer(), LONG);

    await support.reply(customer(), thread.reference, 'Adding a second message to it.');

    const before = await unreadFor(thread.reference);

    expect(
      before,
      'the fixture must start with something waiting on staff',
    ).toBeGreaterThan(0);

    await support.close(customer(), thread.reference);

    expect(await unreadFor(thread.reference)).toBe(0);
  });

  /** The button is on a reloadable page, so the second press must mean what the first did. */
  it('is idempotent', async () => {
    const thread = await support.open(customer(), LONG);

    await support.close(customer(), thread.reference);
    const again = await support.close(customer(), thread.reference);

    expect(again.closed).toBe(true);
  });

  /** Closing is final. Reopening silently would hide that the thread was ended. */
  it('refuses a reply after the asker closes it', async () => {
    const thread = await support.open(customer(), LONG);

    await support.close(customer(), thread.reference);

    await expect(
      support.reply(customer(), thread.reference, 'Actually, one more thing.'),
    ).rejects.toMatchObject({ status: 400, response: { code: 'support.ticket_closed' } });
  });

  /** The same boundary every other read and write here enforces: it is a 404, not a 403. */
  it('is a 404 when closing somebody else’s ticket', async () => {
    const theirs = await support.open(customer(OTHER_PROFILE_ID, OTHER_USER_ID), LONG);

    await expect(support.close(customer(), theirs.reference)).rejects.toMatchObject({
      status: 404,
    });
  });

  /** A partner closes their own the same way, through the same method and the same scope. */
  it('lets a partner close a partner ticket', async () => {
    const thread = await support.open(partner, LONG);

    expect((await support.close(partner, thread.reference)).closed).toBe(true);
  });

  const unreadFor = async (reference: string): Promise<number> =>
    Number(
      (
        await db.execute<{ n: string }>(sql`
          SELECT unread_for_staff::text AS n FROM conversations WHERE reference = ${reference}
        `)
      ).rows[0]?.n ?? -1,
    );

  // ─── Paging ───────────────────────────────────────────────────────────────

  it('pages without repeating or losing a ticket', async () => {
    for (let n = 0; n < 3; n += 1) {
      await support.open(customer(), `${LONG} Number ${n}.`);
    }

    const first = await support.list(customer(), { limit: 2 });
    const second = await support.list(customer(), {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const seen = [...first.items, ...second.items].map((t) => t.reference);

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect(second.nextCursor).toBeNull();
  });

  /**
   * The cursor is on `created_at`, which never moves.
   *
   * Ordering by `last_message_at` would read better and page wrongly: a reply changes it, so a row can
   * jump between pages and silently take another with it.
   */
  it('keeps paging stable when an older ticket gets a new reply', async () => {
    const oldest = await support.open(customer(), `${LONG} One.`);
    await support.open(customer(), `${LONG} Two.`);
    await support.open(customer(), `${LONG} Three.`);

    const first = await support.list(customer(), { limit: 2 });

    await support.reply(customer(), oldest.reference, 'Bumping this one.');

    const second = await support.list(customer(), {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const seen = [...first.items, ...second.items].map((t) => t.reference);

    expect(new Set(seen).size, 'a bumped ticket must not appear twice').toBe(3);
  });

  it('refuses a forged cursor', async () => {
    await expect(
      support.list(customer(), { limit: 20, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

async function seed(db: Database): Promise<void> {
  for (const [id, email, role] of [
    [USER_ID, 'sup-one@safra.test', 'customer'],
    [OTHER_USER_ID, 'sup-two@safra.test', 'customer'],
    [PARTNER_USER_ID, 'sup-partner@safra.test', 'partner'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO users (id, email, role)
      VALUES (${id}::uuid, ${email}, ${role}::user_role)
      ON CONFLICT DO NOTHING`);
  }

  for (const [id, userId, name, email] of [
    [PROFILE_ID, USER_ID, 'واحد', 'sup-one@safra.test'],
    [OTHER_PROFILE_ID, OTHER_USER_ID, 'اثنان', 'sup-two@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
      VALUES (${id}::uuid, ${userId}::uuid, ${name}, ${email}, '+963900000050', false)
      ON CONFLICT DO NOTHING`);
  }

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${PARTNER_USER_ID}::uuid, pt.id, 'Sup', 'دعم', c.id,
           'Addr', '+963900000051', 'sup-partner@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);
}
