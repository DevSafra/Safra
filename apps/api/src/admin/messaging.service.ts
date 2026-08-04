import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';
import { type CursorPage, decodeCursor, encodeCursor } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { redactContactDetails } from '../messaging/redaction.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { scopeFilter } from '../rbac/scope.sql.js';

export const staffReplySchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    /**
     * An internal note is visible to staff only.
     *
     * Defaults to false, so the safe-by-omission case is the one where a caller forgot the flag
     * and the message goes to the customer — which is wrong for a note but harmless, whereas
     * defaulting the other way would silently hide replies the customer was waiting for.
     */
    internal: z.boolean().default(false),
  })
  .strict();

export type StaffReplyInput = z.infer<typeof staffReplySchema>;

export interface ConversationRow {
  readonly reference: string;
  /** `booking` | `dispute` | `partner` — what the thread is about. */
  readonly subjectKind: string;
  readonly subjectReference: string | null;
  readonly customer: string | null;
  readonly partner: string | null;
  readonly lastMessage: string | null;
  readonly lastMessageAt: string | null;
  readonly unreadForStaff: number;
  readonly messageCount: number;
  readonly closed: boolean;
}

export interface MessageRow {
  readonly senderKind: string;
  readonly senderEmail: string | null;
  readonly body: string;
  readonly redactedCount: number;
  readonly internal: boolean;
  readonly at: string;
}

/**
 * الرسائل — the three-party inbox (SRS §10, design handoff §8).
 *
 * ## One thread, three parties
 *
 * Customer ↔ SAFRA ↔ partner in one ordered thread, because the handoff's rule is that SAFRA
 * watches and steers. Two two-party threads would put a customer's complaint and the partner's
 * account of the same night in different places, and make "who said what, when" unanswerable —
 * which is the question a dispute turns on.
 *
 * ## Replies are redacted on the way in
 *
 * Every message body passes through `redactContactDetails` before it is stored, including staff
 * replies. Exempting staff would be the obvious shortcut and the wrong one: a support agent
 * pasting a partner's number to a customer defeats the rule just as thoroughly, and the mask makes
 * the attempt visible in a thread nobody can edit afterwards.
 */
@Injectable()
export class MessagingService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async conversations(query: {
    limit: number;
    cursor?: string | undefined;
    q?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<CursorPage<ConversationRow>> {
    /*
      A conversation has no city; it inherits one from whatever it is about. `coalesce` over the
      booking and the partner covers all three subject kinds — a dispute-scoped thread reaches a
      booking through the dispute, and a partner thread uses the partner's own city.
    */
    const conditions: SQL[] = [
      sql`c.deleted_at IS NULL`,
      scopeFilter(query.actor, 'coalesce(b.city_id, p.city_id)'),
    ];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(c.reference ILIKE ${query.q + '%'}
             OR b.reference ILIKE ${query.q + '%'}
             OR d.reference ILIKE ${query.q + '%'}
             OR cust.full_name ILIKE ${term}
             OR p.display_name ILIKE ${term})`,
      );
    }

    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);

      if (!after) throw new BadRequestException('Malformed pagination cursor.');

      conditions.push(
        sql`(c.created_at, c.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`,
      );
    }

    const result = await this.db.execute<ConversationRowSql>(sql`
      SELECT c.id, c.reference,
             CASE WHEN c.booking_id IS NOT NULL THEN 'booking'
                  WHEN c.dispute_id IS NOT NULL THEN 'dispute'
                  ELSE 'partner' END        AS subject_kind,
             coalesce(b.reference, d.reference, p.reference) AS subject_reference,
             cust.full_name                 AS customer,
             p.display_name                 AS partner,
             c.unread_for_staff,
             (c.closed_at IS NOT NULL)      AS closed,
             coalesce(m.n, 0)::int          AS message_count,
             last.body                      AS last_message,
             to_char(c.last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
               AS last_message_at,
             c.created_at
      FROM conversations c
      LEFT JOIN bookings b          ON b.id = c.booking_id
      LEFT JOIN disputes d          ON d.id = c.dispute_id
      LEFT JOIN partners p          ON p.id = coalesce(c.partner_id, b.partner_id, d.partner_id)
      LEFT JOIN customer_profiles cust ON cust.id = c.customer_profile_id
      LEFT JOIN (
        SELECT conversation_id, count(*) AS n FROM messages GROUP BY conversation_id
      ) m ON m.conversation_id = c.id
      -- LATERAL rather than a window over every message: the inbox needs one row per thread and
      -- this stops at the newest, using the (conversation_id, created_at) index.
      LEFT JOIN LATERAL (
        SELECT body FROM messages
        WHERE conversation_id = c.id AND internal = false
        ORDER BY created_at DESC LIMIT 1
      ) last ON TRUE
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${query.limit + 1}
    `);

    const hasMore = result.rows.length > query.limit;
    const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        reference: row.reference,
        subjectKind: row.subject_kind,
        subjectReference: row.subject_reference,
        customer: row.customer,
        partner: row.partner,
        lastMessage: row.last_message,
        lastMessageAt: row.last_message_at,
        unreadForStaff: row.unread_for_staff,
        messageCount: row.message_count,
        closed: row.closed,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /** One thread in full, oldest first — the order it was written in. */
  async thread(reference: string): Promise<MessageRow[]> {
    const result = await this.db.execute<{
      sender_kind: string;
      sender_email: string | null;
      body: string;
      redacted_count: number;
      internal: boolean;
      at: string;
    }>(sql`
      SELECT m.sender_kind::text AS sender_kind,
             u.email             AS sender_email,
             m.body, m.redacted_count, m.internal,
             to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN users u    ON u.id = m.sender_user_id
      WHERE c.reference = ${reference} AND c.deleted_at IS NULL
      ORDER BY m.created_at ASC
      LIMIT 200
    `);

    return result.rows.map((row) => ({
      senderKind: row.sender_kind,
      senderEmail: row.sender_email,
      body: row.body,
      redactedCount: row.redacted_count,
      internal: row.internal,
      at: row.at,
    }));
  }

  /**
   * Posts a staff reply and clears the thread's unread count.
   *
   * One transaction: the message, the thread's `last_message_at`, and the unread reset. A reply
   * that landed without clearing the badge would leave the thread looking unanswered, and the
   * next agent would answer it twice.
   */
  async reply(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: StaffReplyInput,
  ): Promise<MessageRow[]> {
    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM conversations
      WHERE reference = ${reference} AND deleted_at IS NULL AND closed_at IS NULL
      LIMIT 1
    `);

    const conversation = found.rows[0];

    if (!conversation) throw new NotFoundException('Conversation not found or closed.');

    // Staff are not exempt — see the class note.
    const redacted = redactContactDetails(input.body);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO messages
          (conversation_id, sender_kind, sender_user_id, body, redacted_count, internal)
        VALUES (${conversation.id}::uuid, 'staff', ${actor?.sub}::uuid,
                ${redacted.body}, ${redacted.redactedCount}, ${input.internal})
      `);

      await tx.execute(sql`
        UPDATE conversations
        SET last_message_at = now(), unread_for_staff = 0
        WHERE id = ${conversation.id}::uuid
      `);
    });

    return this.thread(reference);
  }

  // ── واتساب والبريد ─────────────────────────────────────────────────────────

  /**
   * The delivery log.
   *
   * No recipient address is stored or returned — see the `notifications` table comment. The
   * customer or partner it went to is reachable through the reference, which is what an operator
   * needs to act, without turning this screen into a contact directory.
   */
  async notifications(query: {
    limit: number;
    cursor?: string | undefined;
    q?: string | undefined;
    status?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<CursorPage<NotificationRow>> {
    const conditions: SQL[] = [
      sql`n.deleted_at IS NULL`,
      scopeFilter(query.actor, 'coalesce(b.city_id, p.city_id)'),
    ];

    if (query.status) {
      conditions.push(sql`n.status = ${query.status}::notification_status`);
    }

    if (query.q) {
      conditions.push(
        sql`(n.template_key ILIKE ${`%${query.q}%`}
             OR b.reference ILIKE ${query.q + '%'}
             OR d.reference ILIKE ${query.q + '%'})`,
      );
    }

    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);

      if (!after) throw new BadRequestException('Malformed pagination cursor.');

      conditions.push(
        sql`(n.created_at, n.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`,
      );
    }

    const result = await this.db.execute<NotificationRowSql>(sql`
      SELECT n.id,
             n.channel::text AS channel,
             n.template_key,
             n.locale,
             n.status::text  AS status,
             n.attempts,
             n.failure_reason,
             coalesce(b.reference, d.reference, p.reference) AS subject_reference,
             to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
             n.created_at
      FROM notifications n
      LEFT JOIN bookings b ON b.id = n.booking_id
      LEFT JOIN disputes d ON d.id = n.dispute_id
      LEFT JOIN partners p ON p.id = n.partner_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ${query.limit + 1}
    `);

    const hasMore = result.rows.length > query.limit;
    const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        channel: row.channel,
        templateKey: row.template_key,
        locale: row.locale,
        status: row.status,
        attempts: row.attempts,
        failureReason: row.failure_reason,
        subjectReference: row.subject_reference,
        at: row.at,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /**
   * Delivery counts per channel and status, for the screen's summary.
   *
   * One grouped query. The interesting number is failures — a template failing for every German
   * recipient is a bug, three scattered failures are the network — so the shape is per template
   * as well as per status.
   */
  async notificationCounters(): Promise<NotificationCounters> {
    const result = await this.db.execute<{
      channel: string;
      status: string;
      n: string;
    }>(sql`
      SELECT n.channel::text AS channel, n.status::text AS status, count(*)::text AS n
      FROM notifications n
      WHERE n.deleted_at IS NULL AND n.created_at >= current_date - interval '30 days'
      GROUP BY n.channel, n.status
    `);

    const byChannel: Record<string, Record<string, number>> = {};

    for (const row of result.rows) {
      byChannel[row.channel] ??= {};
      (byChannel[row.channel] as Record<string, number>)[row.status] = Number(row.n);
    }

    return { windowDays: 30, byChannel };
  }
}

export interface NotificationRow {
  readonly channel: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly status: string;
  readonly attempts: number;
  readonly failureReason: string | null;
  readonly subjectReference: string | null;
  readonly at: string;
}

export interface NotificationCounters {
  readonly windowDays: number;
  /** `{ whatsapp: { sent: 12, failed: 1 }, email: { … } }` */
  readonly byChannel: Record<string, Record<string, number>>;
}

interface ConversationRowSql extends Record<string, unknown> {
  id: string;
  reference: string;
  subject_kind: string;
  subject_reference: string | null;
  customer: string | null;
  partner: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_for_staff: number;
  message_count: number;
  closed: boolean;
  created_at: string;
}

interface NotificationRowSql extends Record<string, unknown> {
  id: string;
  channel: string;
  template_key: string;
  locale: string;
  status: string;
  attempts: number;
  failure_reason: string | null;
  subject_reference: string | null;
  at: string;
  created_at: string;
}
