import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  partnerFineWaivedMail,
  partnerFinedMail,
  partnerSuspendedMail,
  partnerUnsuspendedMail,
  partnerWarnedMail,
} from '../mail/mail.templates.js';
import type { OutgoingMail } from '../mail/mail.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Telling a partner that an enforcement action changed their standing.
 *
 * > Bashar, 2026-08-24: *"The partner must be notified whenever an administrative or financial
 * > enforcement action changes their status, obligations, or access."*
 *
 * ## Why this is its own class
 *
 * Five events — warned, fined, suspended, unsuspended, fine waived — each needing the same six
 * decisions: who receives it, in which language, on which two channels, with which link, what the
 * audit records, and what happens when delivery fails. Those decisions were made twice before this
 * existed (suspension and the waiver) and not at all for the other three, which is exactly how the
 * console came to say «وأُبلغ الشريك» for actions that told nobody. One place, five callers.
 *
 * ## The recipient is the ACCOUNT, not `partners.email`
 *
 * `O-partner-11`. Enforcement mail used to go to `partners.email` — the address on the APPLICATION
 * — and for the main fixture that diverged from the account when the partner was handed a new
 * address on 2026-08-21: the record read `partner1@safra.test` while the owner signed in as
 * `partner1-legacy@safra.test`. A suspended business being told nothing, at the one moment the
 * platform most needs them to read something, is the failure that shape produces. `users.email` is
 * the address that operates the portal, so it is the address that is told what happened to it.
 *
 * ## Both channels, every time
 *
 * An in-app row so the notice survives a spam filter and can be re-read on the screen it concerns,
 * and an email so somebody who is not looking at the portal finds out. Neither is a fallback for
 * the other: the email exists because the partner is elsewhere, the in-app row because email is
 * unreliable and undated in memory.
 *
 * ## Nothing here can undo an enforcement decision
 *
 * Every method is called AFTER its transaction has committed and every failure is swallowed and
 * logged. A mail server holding a row lock is not a reason to un-suspend a business, and a partner
 * still trading because SMTP was slow is the wrong direction for this particular failure.
 */
@Injectable()
export class EnforcementNotifier {
  private readonly logger = new Logger(EnforcementNotifier.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The address that operates the portal, and the language it reads in.
   *
   * Both come from `users`, joined from the partner — one row, one round trip, and no chance of
   * addressing a notice in one place and choosing its language in another.
   */
  private async recipient(
    partnerId: string,
  ): Promise<{ email: string; locale: string } | null> {
    const rows = await this.db.execute<{ email: string; locale: string }>(sql`
      SELECT u.email, u.preferred_locale AS locale
      FROM partners p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = ${partnerId}::uuid AND p.deleted_at IS NULL
      LIMIT 1
    `);

    return rows.rows[0] ?? null;
  }

  /**
   * Creates both notifications and records what happened, without ever throwing.
   *
   * ## The audit row is about DELIVERY, not about the decision
   *
   * `violation.warned` already records that somebody decided to warn. This records whether the
   * partner was told — a separate fact with a separate failure mode, and the standing requirement
   * is that the trail distinguishes them. It carries the template and the outcome per channel and
   * **no address**: the recipient is identified by the partner id the row already points at.
   *
   * ## `attempted` is what the console is allowed to claim
   *
   * The console may say «وأُبلغ الشريك» only when creation was ATTEMPTED, which is what this
   * returns. Queued is not delivered — a mail can still bounce — so nothing anywhere claims the
   * partner has read it.
   */
  private async send(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    templateKey: string,
    build: (to: string, locale: string) => OutgoingMail,
  ): Promise<void> {
    let inApp: 'created' | 'failed' = 'failed';
    let email: 'queued' | 'failed' = 'failed';

    try {
      const who = await this.recipient(partnerId);

      if (!who) {
        this.logger.error(
          `No account for partner ${partnerId}; the ${templateKey} notice was not created.`,
        );
      } else {
        /*
          In-app FIRST, because it is the one that cannot fail for somebody else's reasons.

          If the queue is down the partner still has the notice on the screen the action concerns.
          Ordering it second would mean a Redis outage produced no record at all of an enforcement
          action the partner is entitled to see.
        */
        try {
          await this.notifications.recordInApp(templateKey, who.locale, { partnerId });
          inApp = 'created';
        } catch (error) {
          this.logger.error(
            `In-app ${templateKey} for partner ${partnerId} failed.`,
            error instanceof Error ? error.stack : undefined,
          );
        }

        try {
          await this.notifications.notify(
            templateKey,
            build(who.email, who.locale),
            who.locale,
            { partnerId },
          );
          email = 'queued';
        } catch (error) {
          this.logger.error(
            `Email ${templateKey} for partner ${partnerId} failed.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Could not notify partner ${partnerId} of ${templateKey}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    /*
      Audited whatever happened, including nothing happening.

      A notification that was never created is the case somebody investigating a dispute most needs
      to find, and it is the one an audit written only on success cannot show.
    */
    try {
      await this.audit.record({
        actorUserId: actor?.sub,
        actorRole: actor?.role,
        action: 'partner.notified',
        subjectType: 'partner',
        subjectId: partnerId,
        after: { templateKey, inApp, email },
      });
    } catch (error) {
      this.logger.error(
        `Could not audit the ${templateKey} notice for partner ${partnerId}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Where a notice sends the reader. Always an authenticated portal page, never a detail in mail. */
  private url(path: string): string {
    return `${this.env.PARTNER_URL}${path}`;
  }

  async warned(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: { note: string; date: string },
  ): Promise<void> {
    await this.send(actor, partnerId, 'partner.warned', (to, locale) =>
      partnerWarnedMail({
        to,
        locale,
        note: input.note,
        date: input.date,
        url: this.url('/violations'),
      }),
    );
  }

  async fined(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: { amount: string; reason: string; date: string },
  ): Promise<void> {
    await this.send(actor, partnerId, 'partner.fined', (to, locale) =>
      partnerFinedMail({
        to,
        locale,
        amount: input.amount,
        reason: input.reason,
        date: input.date,
        url: this.url('/violations'),
      }),
    );
  }

  async suspended(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: { reason: string; date: string },
  ): Promise<void> {
    await this.send(actor, partnerId, 'partner.suspended', (to, locale) =>
      partnerSuspendedMail({
        to,
        locale,
        reason: input.reason,
        date: input.date,
        url: this.url('/'),
      }),
    );
  }

  async unsuspended(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: { reason: string; date: string },
  ): Promise<void> {
    await this.send(actor, partnerId, 'partner.unsuspended', (to, locale) =>
      partnerUnsuspendedMail({
        to,
        locale,
        reason: input.reason,
        date: input.date,
        url: this.url('/'),
      }),
    );
  }

  async fineWaived(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: { amount: string; reason: string; date: string },
  ): Promise<void> {
    await this.send(actor, partnerId, 'partner.fine_waived', (to, locale) =>
      partnerFineWaivedMail({
        to,
        locale,
        amount: input.amount,
        reason: input.reason,
        date: input.date,
        url: this.url('/violations'),
      }),
    );
  }
}
