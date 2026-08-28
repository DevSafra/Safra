import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';
import { COUNT_CAP, ERROR, type OffsetPage, offsetPage } from '@safra/contracts';
import { resolveLocale } from '@safra/i18n';

import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { supportClosedMail, supportRepliedMail } from '../mail/mail.templates.js';
import { NotificationService } from '../notifications/notification.service.js';
import { redactIncomingMessage } from '../messaging/redaction.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import { notFound } from '../common/errors/app-error.js';

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
 *
 * ## A reply on a TICKET reaches the person who is waiting for it
 *
 * A staff answer used to be discoverable only by returning to the page, which made الدعم somewhere
 * people check rather than somewhere they are answered. `reply` now emails the asker — see
 * `notifyAskerOfReply` for who that is, what the email may contain, and why an internal note is
 * silent.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    /* `notifier`, not `notifications` — this class already has a `notifications()` READ, the log. */
    private readonly notifier: NotificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The row count for a page, capped, over the same `FROM … WHERE` the list uses. */
  private async countOf(fromWhere: SQL): Promise<number> {
    /*
      Counted over a LIMIT-ed subquery, so the database stops reading at COUNT_CAP + 1 rows
      instead of scanning the whole matching set. An uncapped count(*) is unbounded work on
      every page view of an ever-growing table — which rule 2 forbids — and nobody reading a
      console table needs to know the exact size of a set they will never page through.
    */
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  /** `OFFSET` for a 1-based page. */
  private pageOffset(query: { page: number; limit: number }): SQL {
    return sql`OFFSET ${(query.page - 1) * query.limit}`;
  }

  async conversations(query: {
    limit: number;
    page: number;
    q?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<ConversationRow>> {
    /* Where a conversation's city comes from: see `subjectJoins`. */
    const conditions: SQL[] = [
      sql`c.deleted_at IS NULL`,
      /*
        A SUPPORT TICKET has no city, and a city-scoped operator must still see it.

        The filter keys on `coalesce(booking.city, partner.city)`, which is NULL for a customer's ticket
        — and a NULL never matches an `IN (…)` list, so every ticket would have vanished from a regional
        operator's inbox while looking present to a super admin. Tickets are unrouted by nature: nobody
        has decided whose they are yet, so everyone who can read the inbox can see them.
      */
      sql`(${scopeFilter(query.actor, 'coalesce(b.city_id, p.city_id)')}
           OR coalesce(b.city_id, p.city_id) IS NULL)`,
    ];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(c.reference ILIKE ${query.q + '%'}
             OR b.reference ILIKE ${query.q + '%'}
             OR d.reference ILIKE ${query.q + '%'}
             /*
               The CUSTOMER's reference — cust, not c, which is the conversation.

               Every other reference this list holds was searchable and the customer's was not, so
               «CUS-1069556» found nothing while that customer had sixty-six conversations. Found
               when the customer record grew a link here (2026-08-26): searching by NAME instead
               would have worked and been wrong, because two people share a name and a link built
               from one would open the other's threads.
             */
             OR cust.reference ILIKE ${query.q + '%'}
             OR cust.full_name ILIKE ${term}
             OR p.display_name ILIKE ${term})`,
      );
    }

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM conversations c
      ${this.subjectJoins}
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
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [result, total] = await Promise.all([
      this.db.execute<ConversationRowSql>(sql`
      SELECT c.id, c.reference,
             CASE WHEN c.booking_id IS NOT NULL THEN 'booking'
                  WHEN c.dispute_id IS NOT NULL THEN 'dispute'
                  WHEN c.partner_id IS NOT NULL THEN 'partner'
                  ELSE 'support' END        AS subject_kind,
             coalesce(b.reference, d.reference, p.reference, c.reference) AS subject_reference,
             cust.full_name                 AS customer,
             p.display_name                 AS partner,
             c.unread_for_staff,
             (c.closed_at IS NOT NULL)      AS closed,
             coalesce(m.n, 0)::int          AS message_count,
             last.body                      AS last_message,
             to_char(c.last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
               AS last_message_at,
             c.created_at
      ${fromWhere}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
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
      total,
      query,
    );
  }

  /** One thread in full, oldest first — the order it was written in. */
  /**
   * One conversation's messages, scoped like the registry that lists them (`O-sec-13`, 2026-08-27).
   *
   * `conversations` has been in `SCOPED_RESOURCES` since scope was built and the LIST narrows by
   * `coalesce(b.city_id, p.city_id)` — a thread hangs off a booking, or off a partner where there
   * is no booking. Opening one by reference narrowed by nothing, so a city-scoped agent could read
   * any thread in the country, including its internal staff notes.
   *
   * The same expression as the list, deliberately: two ways of deciding which city a conversation
   * is in would be two answers.
   */
  /**
   * The thread behind a reference, if this actor's cities include it.
   *
   * Deliberately WITHOUT `closed_at IS NULL`: both callers need to tell a finished thread from an
   * absent one — the screen to stop offering a reply box, and `close` because a second click is an
   * ordinary thing to do rather than a thread that has vanished. `reply` keeps its own predicate,
   * where closed genuinely does mean «not available».
   */
  /**
   * The joins that give a conversation its CITY, and nothing else.
   *
   * A conversation has no city of its own; it inherits one from whatever it is about. A booking
   * thread takes the booking's, a partner thread the partner's, and a DISPUTE thread reaches the
   * partner through the dispute — `coalesce(c.partner_id, b.partner_id, d.partner_id)`.
   *
   * Written once because it was written twice. The inbox reached the partner through the dispute
   * and the four single-thread queries did not, so a dispute thread scoped to Aleppo was absent
   * from a Damascus operator's list and readable — and repliable — by that same operator the
   * moment they had its reference. A NULL city reads as «platform-level, everybody may», which is
   * right for an unrouted support ticket and wrong for a case about a specific property.
   */
  private get subjectJoins(): SQL {
    return sql`
      LEFT JOIN bookings b ON b.id = c.booking_id
      LEFT JOIN disputes d ON d.id = c.dispute_id
      LEFT JOIN partners p ON p.id = coalesce(c.partner_id, b.partner_id, d.partner_id)
    `;
  }

  private async scopedConversation(
    reference: string,
    actor: AccessTokenClaims | undefined,
  ): Promise<
    { id: string; city_id: string | null; closed_at: string | null } | undefined
  > {
    const found = await this.db.execute<{
      id: string;
      city_id: string | null;
      closed_at: string | null;
    }>(sql`
      SELECT c.id, coalesce(b.city_id, p.city_id)::text AS city_id, c.closed_at::text
      FROM conversations c
      ${this.subjectJoins}
      WHERE c.reference = ${reference} AND c.deleted_at IS NULL
        AND ${scopeFilter(actor, 'coalesce(b.city_id, p.city_id)')}
      LIMIT 1
    `);

    return found.rows[0];
  }

  async thread(
    reference: string,
    actor: AccessTokenClaims | undefined,
  ): Promise<{ closed: boolean; messages: MessageRow[] }> {
    /*
      The thread's own state travels with its messages.

      Without it the screen cannot tell a finished conversation from a live one, and it went on
      offering a reply box over a thread whose reply endpoint refuses everything — the control that
      «does nothing» this codebase keeps finding. One extra indexed lookup on a reference.
    */
    const conversation = await this.scopedConversation(reference, actor);

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
      ${this.subjectJoins}
      LEFT JOIN users u    ON u.id = m.sender_user_id
      WHERE c.reference = ${reference} AND c.deleted_at IS NULL
        AND ${scopeFilter(actor, 'coalesce(b.city_id, p.city_id)')}
      ORDER BY m.created_at ASC
      LIMIT 200
    `);

    return {
      closed: conversation?.closed_at != null,
      messages: result.rows.map((row) => ({
        senderKind: row.sender_kind,
        senderEmail: row.sender_email,
        body: row.body,
        redactedCount: row.redacted_count,
        internal: row.internal,
        at: row.at,
      })),
    };
  }

  /**
   * Posts a staff reply and clears the thread's unread count.
   *
   * One transaction: the message, the thread's `last_message_at`, and the unread reset. A reply
   * that landed without clearing the badge would leave the thread looking unanswered, and the
   * next agent would answer it twice.
   */
  /**
   * Ends a thread from the console — «إنهاء المحادثة».
   *
   * ## The gap this closes
   *
   * `closed_at` had exactly one writer: `SupportService.close`, which is asker-only. So an agent who
   * had fully answered somebody could not end the conversation — it stayed open until the customer
   * or partner closed it themselves, which most people never do. الرسائل accumulated threads that
   * were finished and still looked like work, and the unread badge beside it counts what looks like
   * work. Reported in the الرسائل review of 2026-08-28.
   *
   * ## Closing is not deleting, and it does not silence the thread
   *
   * The messages stay readable, exactly as they do when the asker closes it. §10 makes a thread the
   * record of who said what and when, and the answer to «this is finished» is a closed thread rather
   * than a hidden one. Somebody who needs help again opens a new ticket, which is one action and
   * leaves the first thread intact — `SupportService.close`'s own reasoning, unchanged.
   *
   * ## And the person waiting is told
   *
   * A thread ended by somebody else, silently, leaves the asker waiting for an answer that is not
   * coming. The same reasoning that put a notification on a closed dispute the day before: they
   * found out by looking, or not at all.
   */
  async close(
    actor: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<{ closed: boolean }> {
    /* Scoped both ways, exactly as `reply` is — see `scopedConversation` on the missing predicate. */
    const conversation = await this.scopedConversation(reference, actor);

    if (!conversation) throw notFound(ERROR.CONVERSATION_NOT_FOUND_OR_CLOSED);

    assertCanWrite(actor, conversation.city_id);

    /* Already ended: nothing changes, and no audit row for an event that did not happen. */
    if (conversation.closed_at !== null) return { closed: false };

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE conversations
        SET closed_at = now(), unread_for_staff = 0, updated_at = now()
        WHERE id = ${conversation.id}::uuid AND closed_at IS NULL
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'conversation.closed',
          subjectType: 'conversation',
          subjectId: conversation.id,
          after: { reference },
        },
        tx as unknown as Database,
      );
    });

    /* After the commit, and it cannot fail the closure — see `notifyAskerOfClose`. */
    await this.notifyAskerOfClose(conversation.id, reference);

    return { closed: true };
  }

  async reply(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: StaffReplyInput,
  ): Promise<{ closed: boolean; messages: MessageRow[] }> {
    /*
      Scoped both ways — see `thread`. The predicate so an out-of-scope thread answers exactly as a
      closed or absent one, and `assertCanWrite` so a `read_only` agent who may read the thread
      cannot post into it.
    */
    const found = await this.db.execute<{ id: string; city_id: string | null }>(sql`
      SELECT c.id, coalesce(b.city_id, p.city_id)::text AS city_id
      FROM conversations c
      ${this.subjectJoins}
      WHERE c.reference = ${reference} AND c.deleted_at IS NULL AND c.closed_at IS NULL
        AND ${scopeFilter(actor, 'coalesce(b.city_id, p.city_id)')}
      LIMIT 1
    `);

    const conversation = found.rows[0];

    if (!conversation) throw notFound(ERROR.CONVERSATION_NOT_FOUND_OR_CLOSED);

    assertCanWrite(actor, conversation.city_id);

    // Staff are not exempt — see the class note.
    const redacted = redactIncomingMessage(input.body);

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

    /*
      Told AFTER the transaction has committed, and only for a reply the asker can actually read.

      `internal` is the whole check. An internal note is how staff talk to each other inside the
      thread, and it is filtered out of every read the customer or partner performs — a notice
      saying "you have an answer" that leads to a page showing nothing new is the mildest way that
      leak can go wrong, and naming the note in the subject line is the worst.

      Outside the transaction because the send is still in-request: a mail server that hung would
      otherwise hold a transaction open across an SMTP round trip. The queue this belongs behind is
      FUTURE-WORK item 9 (BullMQ), and `NotificationService.notify` is the seam it moves behind —
      it already records `queued` before sending and swallows a failed send, so a reply is never
      undone by an unreachable mailbox.
    */
    if (!input.internal) {
      await this.notifyAskerOfReply(conversation.id);
    }

    return this.thread(reference, actor);
  }

  /**
   * Emails the customer or partner whose SUPPORT TICKET was just answered.
   *
   * ## Tickets only, and why the others are excluded rather than forgotten
   *
   * The `WHERE` refuses any thread with a booking or a dispute — the same shape
   * `SupportService.scopeOf` defines as "mine". A booking thread has two parties and no route into
   * it from either dashboard: الدعم lists subject-less threads only, so a link to a booking thread's
   * reference answers 404 to the person who followed it. Emailing one would be worse than silence.
   *
   * ## The recipient is derived from the thread, never passed in
   *
   * A ticket names exactly one of the two, so `coalesce` resolves it without a branch. Staff supply
   * the text and nothing about who reads it — the same rule the review and booking notices follow.
   *
   * ## The RECIPIENT's language, not the agent's
   *
   * A customer's is `customer_profiles.preferred_locale` and a partner's is on their user row. The
   * agent writing the reply is Arabic-only by construction, so taking the locale from the actor
   * would send every German customer Arabic and nothing would fail.
   */
  private async notifyAskerOfReply(conversationId: string): Promise<void> {
    /*
      The same lookup the close notice uses, and that is the point: it was written out twice, and
      the note under `askerOfThread` already claimed «one definition of the person waiting rather
      than two that drift». They would have drifted here: widening one predicate for a dispute
      thread and leaving the other means a closure tells the customer and a reply does not.
    */
    const asker = await this.askerOfThread(conversationId);

    if (!asker) return;

    const { email, locale, url, reference } = asker;

    await this.notifier.notify(
      'support.replied',
      supportRepliedMail({
        to: email,
        locale,
        reference,
        url,
      }),
      locale,
      /*
        The RECIPIENT's id, not the thread's.

        `notify`'s subject has no `conversation_id` and does not gain one here. Those columns exist
        so the delivery log can answer "was this person told?", which is asked when somebody
        disputes that they were — and the recipient's id answers it, while a thread id would need a
        migration, a fourth subject FK on a table whose shape already carries three, and a join in
        the console query, to record something the inbox already shows against the same person. The
        ticket itself is not lost: `template_key` is `support.replied` and the thread is one click
        away from the same customer or partner.
      */
      asker.subject,
    );
  }

  /**
   * The person waiting on a thread — address, language, and where to send them.
   *
   * ## Only a thread the recipient can actually open
   *
   * The `WHERE` refuses any thread with a BOOKING — the same shape `SupportService.scopeOf` defines
   * as «mine». A booking thread has two parties and no route into it from either dashboard, so a
   * link to its reference answers 404 to the person who followed it, and writing to one would be
   * worse than silence.
   *
   * A DISPUTE thread is not in that class and is no longer excluded. الدعم lists it on the
   * customer's side and it opens at the same `/account/support/{reference}` this link points at, so
   * the notice leads somewhere. The clause excluding it cost nothing while the column had no
   * writer; keeping it now would mean staff replying into a thread the customer can read and is
   * never told about.
   *
   * ## Active accounts only
   *
   * `coalesce(cu.status, pu.status) = 'active'` is the guard: a suspended or closed account is not
   * written to, and a customer profile with no user at all — a guest, which cannot open a ticket —
   * falls to NULL and is skipped rather than emailed. Safe by omission in both directions.
   *
   * ## The RECIPIENT's language, not the agent's
   *
   * The agent is Arabic-only by construction, so taking the locale from the actor would send every
   * German customer Arabic and nothing would fail. `resolveLocale` decides what an unrecognised
   * value means, so the link always matches the language the message is written in.
   */
  private async askerOfThread(conversationId: string): Promise<{
    email: string;
    locale: string;
    url: string;
    reference: string;
    subject: { customerProfileId: string } | { partnerId: string };
  } | null> {
    const found = await this.db.execute<{
      reference: string;
      customer_profile_id: string | null;
      partner_id: string | null;
      email: string | null;
      locale: string | null;
    }>(sql`
      SELECT c.reference,
             c.customer_profile_id,
             c.partner_id,
             coalesce(cp.email, pu.email)                       AS email,
             coalesce(cp.preferred_locale, pu.preferred_locale) AS locale
      FROM conversations c
      LEFT JOIN customer_profiles cp ON cp.id = c.customer_profile_id
      LEFT JOIN users cu             ON cu.id = cp.user_id
      LEFT JOIN partners pa          ON pa.id = c.partner_id
      LEFT JOIN users pu             ON pu.id = pa.user_id
      WHERE c.id = ${conversationId}::uuid
        AND c.booking_id IS NULL
        AND coalesce(cu.status, pu.status) = 'active'
      LIMIT 1
    `);

    const row = found.rows[0];

    if (!row?.email) return null;

    const locale = resolveLocale(row.locale ?? 'ar');

    if (row.customer_profile_id) {
      return {
        email: row.email,
        locale,
        url: new URL(
          `/${locale}/account/support/${row.reference}`,
          this.env.APP_URL,
        ).toString(),
        reference: row.reference,
        subject: { customerProfileId: row.customer_profile_id },
      };
    }

    if (row.partner_id) {
      return {
        email: row.email,
        locale,
        url: new URL(`/support/${row.reference}`, this.env.PARTNER_URL).toString(),
        reference: row.reference,
        subject: { partnerId: row.partner_id },
      };
    }

    return null;
  }

  /**
   * Tells the asker their TICKET has been ended by SAFRA.
   *
   * A thread closed by somebody else, silently, leaves the person who opened it waiting for an
   * answer that is not coming. The same reasoning that put a notice on a closed dispute the day
   * before: they found out by looking, or not at all.
   *
   * Everything about WHO is `askerOfThread`'s — reachable threads only, active accounts only, the
   * recipient's own language — so there is one definition of «the person waiting», now used by both
   * notices rather than written out twice.
   */
  private async notifyAskerOfClose(
    conversationId: string,
    reference: string,
  ): Promise<void> {
    const asker = await this.askerOfThread(conversationId);

    if (!asker) return;

    try {
      await this.notifier.notify(
        'support.closed',
        supportClosedMail({
          to: asker.email,
          locale: asker.locale,
          reference,
          url: asker.url,
        }),
        asker.locale,
        asker.subject,
      );
    } catch (error) {
      /*
        Swallowed. The thread IS closed — the transaction committed before this ran — and an agent
        told their close had failed would reasonably do it again.
      */
      this.logger.error(
        `Could not tell the asker that thread ${reference} was closed.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
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
    page: number;
    q?: string | undefined;
    status?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<NotificationRow>> {
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

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM notifications n
      LEFT JOIN bookings b ON b.id = n.booking_id
      LEFT JOIN disputes d ON d.id = n.dispute_id
      LEFT JOIN partners p ON p.id = n.partner_id
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [result, total] = await Promise.all([
      this.db.execute<NotificationRowSql>(sql`
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
      ${fromWhere}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        channel: row.channel,
        templateKey: row.template_key,
        locale: row.locale,
        status: row.status,
        attempts: row.attempts,
        failureReason: row.failure_reason,
        subjectReference: row.subject_reference,
        at: row.at,
      })),
      total,
      query,
    );
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
