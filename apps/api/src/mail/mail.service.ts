import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { ENV, type Env } from '../config/env.js';
import { describeError } from '../common/errors/safe-error.js';

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  /** Plain text. Every SAFRA email must be readable without HTML (§10.3). */
  readonly text: string;
  readonly html?: string | undefined;
  /**
   * The body carries a SECRET that is worth more than the convenience of reading it in a log.
   *
   * With no SMTP transport configured the branch below prints whole bodies, which is right for a
   * reset link a developer needs to click. It is not right for a gift card code: `gift_cards` stores
   * only a hash precisely so a plaintext code exists nowhere at rest, and a dev log is somewhere.
   * Nothing is lost by suppressing it either — the purchase RESPONSE carries the code, which is how
   * a developer gets it anyway.
   */
  readonly sensitive?: boolean | undefined;
}

/**
 * Outbound email (SRS §10.3).
 *
 * Two transports behind one interface, chosen by whether `SMTP_URL` is configured:
 *
 *  - **SMTP** in staging and production.
 *  - **Log** everywhere else, so a fresh checkout runs with no mail server and CI
 *    never sends anything to a real address. The log line includes the body, which
 *    is how a developer gets at a password-reset link locally.
 *
 * `loadEnv` refuses to boot production without SMTP, because the log transport fails
 * in the worst possible way there: everything reports success and no customer ever
 * receives anything.
 *
 * ## Sending never blocks the caller
 *
 * `send()` resolves even when delivery fails, and logs the failure. A password reset
 * whose email bounced must not roll back the token that was just issued — the
 * customer can request another, whereas a 500 tells them the whole feature is broken.
 * The same reasoning as the SLA sweep: never throw out of a side effect.
 *
 * Delivery moves onto BullMQ with the rest of §14's background work; the interface
 * is deliberately fire-and-forget so that change is internal.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(@Inject(ENV) env: Env) {
    this.from = env.MAIL_FROM;

    this.transport = env.SMTP_URL
      ? createTransport(env.SMTP_URL, { from: env.MAIL_FROM })
      : null;

    if (!this.transport) {
      this.logger.warn(
        'No SMTP_URL configured: email will be LOGGED, not sent. Fine for ' +
          'development; production refuses to boot in this state.',
      );
    }
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transport) {
      /**
       * The whole body, deliberately. A developer needs the reset link, and there
       * is nothing sensitive here that is not already going to an inbox in clear.
       * This branch cannot run in production — `loadEnv` sees to that.
       */
      this.logger.log(
        mail.sensitive
          ? `[mail:not-sent] to=${mail.to} subject="${mail.subject}" (body withheld: carries a secret)`
          : `[mail:not-sent] to=${mail.to} subject="${mail.subject}"\n${mail.text}`,
      );
      return;
    }

    try {
      await this.transport.sendMail({
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      });
    } catch (error) {
      /**
       * Logged with the recipient but WITHOUT the body: a reset link in a log file
       * is a credential in a log file (rule 1), and logs are shipped to places the
       * email itself never goes.
       */
      this.logger.error(
        `Failed to send "${mail.subject}" to ${mail.to}: ` + `${describeError(error)}`,
      );
    }
  }
}
