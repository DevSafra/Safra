import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type SupportMessage,
  type SupportQuery,
  type SupportThread,
  type SupportTicket,
  decodeCursor,
  encodeCursor,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { redactIncomingMessage } from '../messaging/redaction.js';
import { badRequest, notFound, unauthorized } from '../common/errors/app-error.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `CNV-000042`. Bounded before it reaches a query — the lookup is parameterised regardless. */
const REFERENCE_PATTERN = /^CNV-\d{1,12}$/;

/**
 * Who is asking, and therefore which threads exist for them.
 *
 * A customer and a partner are scoped by DIFFERENT columns, and neither may name the column's value —
 * it comes from the verified token. Staff have their own module (`admin/messaging.service.ts`) and do
 * not come through here.
 */
type Asker =
  | { readonly kind: 'customer'; readonly profileId: string; readonly userId: string }
  | { readonly kind: 'partner'; readonly partnerId: string; readonly userId: string }
  | {
      readonly kind: 'partner_employee';
      readonly partnerId: string;
      readonly userId: string;
    };

/**
 * Which enum value goes in `messages.sender_kind`.
 *
 * An employee writes AS the business — `message_sender` has `customer`, `partner`, `staff` and
 * `system`, and an employee is the partner speaking. This exists because `asker.kind` was cast
 * straight into that column, so adding a third asker would have inserted `'partner_employee'` into
 * an enum with no such value and answered 500 on the first employee ticket.
 */
function senderKindOf(asker: Asker): 'customer' | 'partner' {
  return asker.kind === 'customer' ? 'customer' : 'partner';
}

type TicketRow = {
  id: string;
  reference: string;
  created_at: string;
  last_message_at: string | null;
  closed_at: string | null;
  message_count: number;
  last_message: string | null;
};

/**
 * الدعم — opening and continuing a support request.
 *
 * ## A ticket is a subject-less conversation
 *
 * `conversations_exactly_one_subject_v2` allows a thread with no booking, dispute or partner provided a
 * customer is named; a partner's ticket is the long-standing `partner_id`-only shape. So a ticket needs
 * no new table, and it lands in the console's existing inbox rather than in a second place staff have to
 * remember to look.
 *
 * ## Every body is redacted, including the first
 *
 * `redactContactDetails` runs on the way IN and the original is not kept — the same rule the messaging
 * module applies to staff replies. A support form is the most obvious place to try to pass a phone
 * number, so exempting it would quietly reopen the hole the rule exists to close. `redactedCount` tells
 * the sender it happened, because somebody whose number was masked will otherwise wait for a call that
 * cannot come.
 *
 * ## Internal notes are never returned
 *
 * `messages.internal` is how staff talk to each other inside a thread. Every read here filters it out.
 * That is one `AND internal = false` standing between a customer and staff's private assessment of
 * their complaint, so it is applied in ONE place — `messagesOf` — rather than at each call site.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The caller, as a scope. Refuses anyone who is neither a customer nor a partner-side reader.
   *
   * ## Keyed on the ROLE, never on which id happens to be present
   *
   * This branched on `customerProfileId` first and fell through to `partnerId`, which was correct
   * only while the two were mutually exclusive. They stopped being on 2026-08-23, when a customer
   * profile started being resolved for anyone who HAS one rather than only for `role = 'customer'`
   * — so a partner who also books trips with SAFRA, which is an ordinary thing for a hotelier to
   * do, silently became a `customer` here and their business's support threads disappeared.
   *
   * `role` is the right discriminator because it answers what the account is DOING, which is
   * exactly the question الدعم asks: whose tickets does "my tickets" mean.
   */
  private askerOf(claims: AccessTokenClaims | undefined): Asker {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    /*
      An employee with no live employment carries no `partnerId` — `attachOwningIds` fails closed
      for a suspended or ended employment. They fall through to the customer branch if they have a
      profile, and are refused if they do not; either way they reach none of the employer's threads.
    */
    if (claims.role === 'partner_employee' && claims.partnerId) {
      return {
        kind: 'partner_employee',
        partnerId: claims.partnerId,
        userId: claims.sub,
      };
    }

    if (claims.role === 'partner' && claims.partnerId) {
      return { kind: 'partner', partnerId: claims.partnerId, userId: claims.sub };
    }

    if (claims.customerProfileId) {
      return {
        kind: 'customer',
        profileId: claims.customerProfileId,
        userId: claims.sub,
      };
    }

    /*
      Staff reach the same threads through the console, which has its own service and its own
      permissions. Sending them here would give them a customer's view of a thread they are meant to
      moderate — including no sight of the internal notes they wrote.
    */
    throw notFound(ERROR.CUSTOMER_NOT_FOUND);
  }

  /**
   * The WHERE fragment that defines "mine", used by every read and write.
   *
   * ## It grew as the shapes did, and each clause is load-bearing
   *
   * It began as «a ticket is subject-less», three NULL checks, because a ticket was the only thing
   * anybody could open. Two shapes have arrived since, and each was invisible to the person it was
   * written for until this predicate learnt it: a DISPUTE thread (2026-08-28) and a thread SAFRA
   * starts on a BOOKING (2026-08-29), which is the three-party record — customer, SAFRA, host —
   * that the design has described from the beginning and nothing could create.
   *
   * The one clause that never moves is the identity: a customer's own profile id, a partner's own
   * id. Everything else is about the SHAPE of the thread; that is the authorization.
   */
  private scopeOf(asker: Asker): SQL {
    if (asker.kind === 'customer') {
      /*
        Their own tickets, the thread on a dispute they are named on, and the thread on their own
        booking. `partner_id IS NULL` is what stays: a partner's correspondence with SAFRA is
        somebody else's business entirely, and no customer is a participant in it.
      */
      return sql`c.partner_id IS NULL
                 AND (c.customer_profile_id = ${asker.profileId}::uuid
                      OR sb.customer_profile_id = ${asker.profileId}::uuid)`;
    }

    /*
      The host's own correspondence, plus the thread on a booking AT THEIR PROPERTY.

      A booking thread is reached through the booking rather than through `partner_id` — the CHECK
      allows a row exactly one subject, so a thread about a booking cannot also carry the host's id.
      Their DISPUTE threads are still excluded and that is deliberate: a dispute is adjudicated by
      SAFRA, and the complainant's account of the night is not something the host reads live.
    */
    const business = sql`(c.partner_id = ${asker.partnerId}::uuid
                          AND c.booking_id IS NULL AND c.dispute_id IS NULL)
                         OR sb.partner_id = ${asker.partnerId}::uuid`;

    /*
      An employee reads ONLY the threads they opened; the owner reads every thread on the business.

      Until employees existed, a business was one person and `partner_id` answered both "whose
      thread is this" and "who may read it". It no longer does. A receptionist and the owner carry
      the same `partner_id`, and the owner's correspondence with SAFRA is exactly where a payout
      dispute, a contract question, or a complaint ABOUT that receptionist gets written down.

      `opened_by_user_id` is NULL on every thread written before the column existed, and `= me`
      excludes NULL — so an employee cannot read a thread that predates them. That is the reason
      migration 0043 does not backfill it.
    */
    /*
      An employee reads only what they opened, and a booking thread is opened by SAFRA — so a
      booking thread is the OWNER's. Deny by default: an employee who needs one asks the owner, and
      widening this later is a decision somebody makes on purpose rather than a side effect of a
      predicate that grew.
    */
    return asker.kind === 'partner_employee'
      ? sql`c.partner_id = ${asker.partnerId}::uuid
            AND c.booking_id IS NULL AND c.dispute_id IS NULL
            AND c.opened_by_user_id = ${asker.userId}::uuid`
      : sql`(${business})`;
  }

  /** The columns a ticket row needs, listed once so the list and the thread cannot diverge. */
  private get projection() {
    return sql`
      c.id, c.reference,
      c.created_at::text      AS created_at,
      c.last_message_at::text AS last_message_at,
      c.closed_at::text       AS closed_at,
      coalesce(m.n, 0)::int   AS message_count,
      last.body               AS last_message
    `;
  }

  /** The joins for the projection. `internal = false` in BOTH, or a count would leak a note's existence. */
  private get joins() {
    return sql`
      FROM conversations c
      -- sb is the thread's SUBJECT booking — how both sides of a three-party thread reach it.
      -- (No backticks in here: they would end this sql template.)
      LEFT JOIN bookings sb ON sb.id = c.booking_id
      LEFT JOIN (
        SELECT conversation_id, count(*) AS n FROM messages
        WHERE internal = false GROUP BY conversation_id
      ) m ON m.conversation_id = c.id
      LEFT JOIN LATERAL (
        SELECT body FROM messages
        WHERE conversation_id = c.id AND internal = false
        ORDER BY created_at DESC LIMIT 1
      ) last ON TRUE
    `;
  }

  private ticketOf(row: TicketRow): SupportTicket {
    return {
      reference: row.reference,
      openedAt: row.created_at,
      lastMessageAt: row.last_message_at,
      closed: row.closed_at !== null,
      messageCount: row.message_count,
      lastMessage: row.last_message,
    };
  }

  /** The visible messages of a thread, oldest first. Internal notes are excluded here and only here. */
  private async messagesOf(conversationId: string): Promise<SupportMessage[]> {
    const rows = await this.db.execute<{
      id: string;
      sender_kind: string;
      body: string;
      redacted_count: number;
      created_at: string;
    }>(sql`
      SELECT id, sender_kind::text AS sender_kind, body, redacted_count,
             created_at::text AS created_at
      FROM messages
      WHERE conversation_id = ${conversationId}::uuid AND internal = false
      ORDER BY created_at ASC
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      sender: row.sender_kind as SupportMessage['sender'],
      body: row.body,
      redactedCount: row.redacted_count,
      createdAt: row.created_at,
    }));
  }

  /** One ticket the caller owns, or a 404 — including when it belongs to somebody else. */
  private async findOwn(asker: Asker, reference: string): Promise<TicketRow> {
    if (!REFERENCE_PATTERN.test(reference)) {
      throw notFound(ERROR.SUPPORT_TICKET_NOT_FOUND);
    }

    const found = await this.db.execute<TicketRow>(sql`
      SELECT ${this.projection}
      ${this.joins}
      WHERE c.reference = ${reference}
        AND c.deleted_at IS NULL
        AND ${this.scopeOf(asker)}
      LIMIT 1
    `);

    const row = found.rows.at(0);

    /*
      The scope is IN the query rather than checked after it. A reference is sequential and quotable, so
      "fetch then compare" would answer a different error for a thread that exists and is not yours —
      which is enough to enumerate other people's tickets.
    */
    if (!row) throw notFound(ERROR.SUPPORT_TICKET_NOT_FOUND);

    return row;
  }

  /** Opens a ticket, with its first message. */
  async open(
    claims: AccessTokenClaims | undefined,
    body: string,
  ): Promise<SupportThread> {
    const asker = this.askerOf(claims);
    const redacted = redactIncomingMessage(body);

    const created = await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO conversations
          (customer_profile_id, partner_id, opened_by_user_id, last_message_at, unread_for_staff)
        VALUES (
          ${asker.kind === 'customer' ? asker.profileId : null}::uuid,
          ${asker.kind === 'customer' ? null : asker.partnerId}::uuid,
          ${asker.userId}::uuid,
          now(), 1
        )
        RETURNING id, reference
      `);

      const conversation = rows.rows.at(0);

      if (!conversation) throw badRequest(ERROR.SUPPORT_TICKET_NOT_FOUND);

      await tx.execute(sql`
        INSERT INTO messages
          (conversation_id, sender_kind, sender_user_id, body, redacted_count, internal)
        VALUES (${conversation.id}::uuid, ${senderKindOf(asker)}::message_sender,
                ${asker.userId}::uuid, ${redacted.body}, ${redacted.redactedCount}, false)
      `);

      return conversation;
    });

    /* Reference and redaction count only — a ticket body is the customer's own words, not log material. */
    this.logger.log(
      `Support ticket ${created.reference} opened by a ${asker.kind}` +
        `${redacted.redactedCount > 0 ? ` (${redacted.redactedCount} contact detail(s) masked)` : ''}.`,
    );

    return this.thread(claims, created.reference);
  }

  /** One ticket with its messages. */
  async thread(
    claims: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<SupportThread> {
    const asker = this.askerOf(claims);
    const row = await this.findOwn(asker, reference);

    return { ...this.ticketOf(row), messages: await this.messagesOf(row.id) };
  }

  /** Adds a message to a ticket the caller owns. */
  async reply(
    claims: AccessTokenClaims | undefined,
    reference: string,
    body: string,
  ): Promise<SupportThread> {
    const asker = this.askerOf(claims);
    const row = await this.findOwn(asker, reference);

    /* A closed thread is read-only. Reopening it silently would hide the fact that staff ended it. */
    if (row.closed_at !== null) throw badRequest(ERROR.SUPPORT_TICKET_CLOSED);

    const redacted = redactIncomingMessage(body);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO messages
          (conversation_id, sender_kind, sender_user_id, body, redacted_count, internal)
        VALUES (${row.id}::uuid, ${senderKindOf(asker)}::message_sender, ${asker.userId}::uuid,
                ${redacted.body}, ${redacted.redactedCount}, false)
      `);

      /*
        `unread_for_staff + 1`, not `= 1`: the counter is what the console sorts its inbox by, and
        overwriting it would make three unanswered messages look like one.
      */
      await tx.execute(sql`
        UPDATE conversations
        SET last_message_at = now(), unread_for_staff = unread_for_staff + 1, updated_at = now()
        WHERE id = ${row.id}::uuid
      `);
    });

    return this.thread(claims, reference);
  }

  /**
   * The asker saying they no longer need help.
   *
   * ## Why this exists
   *
   * Only staff could close a thread, so a problem that resolved itself stayed in the console's queue
   * for ever and somebody eventually read it to find out it was nothing. The unread counter is what
   * the inbox sorts by, so an abandoned ticket does not merely linger — it sits near the top, ahead
   * of people who are still waiting.
   *
   * ## So it clears `unread_for_staff` as well as setting `closed_at`
   *
   * Closing without that would satisfy the letter of the gap and not its point: the thread would read
   * as closed and still be counted as waiting on us. Both are set in one statement.
   *
   * ## Idempotent
   *
   * Closing an already-closed thread returns it rather than failing. The button is on a page that can
   * be reloaded and double-submitted, and the second press means exactly what the first did. A 400
   * here would be a lecture about state the reader cannot see.
   *
   * ## No system message is written into the thread
   *
   * "The customer closed this request" is a sentence, and a message body is stored ONCE while the
   * console reads Arabic and the customer app reads three languages. Storing it would put
   * user-facing copy in a row nobody can translate afterwards — the exact failure the copy rule
   * exists to prevent. The `closed` state is the record; the reader's own interface says what it
   * means, in their own language.
   *
   * ## And it stays closed
   *
   * There is no reopen. `reply` already refuses a closed thread on the grounds that reopening
   * silently would hide the fact that it was ended, and that reasoning does not change when it is the
   * asker who ended it. Somebody who needs help again opens a ticket, which is one action and leaves
   * the first thread readable.
   */
  async close(
    claims: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<SupportThread> {
    const asker = this.askerOf(claims);
    const row = await this.findOwn(asker, reference);

    if (row.closed_at === null) {
      await this.db.execute(sql`
        UPDATE conversations
        SET closed_at = now(), unread_for_staff = 0, updated_at = now()
        WHERE id = ${row.id}::uuid AND closed_at IS NULL
      `);

      this.logger.log(`Support ticket ${reference} closed by the ${asker.kind}.`);
    }

    return this.thread(claims, reference);
  }

  /** The caller's own tickets, newest activity first. */
  async list(claims: AccessTokenClaims | undefined, query: SupportQuery) {
    const asker = this.askerOf(claims);

    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded || !UUID_PATTERN.test(decoded.id)) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    /*
      Ordered by `created_at`, not `last_message_at`, and the keyset is the reason: the cursor column has
      to be immutable, and a reply moves `last_message_at` — which would make a row jump pages between
      two requests and silently skip whatever it passed.
    */
    const keyset = after
      ? sql`AND (c.created_at, c.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    const rows = await this.db.execute<TicketRow>(sql`
      SELECT ${this.projection}
      ${this.joins}
      WHERE c.deleted_at IS NULL
        AND ${this.scopeOf(asker)}
        ${keyset}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => this.ticketOf(row)),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.created_at, last.id)
          : null,
    };
  }
}
