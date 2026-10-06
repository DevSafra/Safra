import { Logger } from '@nestjs/common';

import type { MailService, OutgoingMail } from './mail.service.js';

const logger = new Logger('MailBestEffort');

/**
 * Sends one mail from inside a request whose own work has ALREADY committed, and never throws.
 *
 * ## Why this exists beside a `send` that throws
 *
 * `MailService.send` rethrows since 2026-09-06, and it must: `NotificationService.deliver` marks a
 * row `sent` on the line after it returns, and BullMQ only retries a job that throws. But six
 * callers send directly from a request, after a transaction they cannot take back, and each one of
 * them turned an SMTP refusal into a 500:
 *
 *  - a gift card was bought, paid for and committed, and the response that carries its code (the
 *    only plaintext copy that will ever exist) was replaced by an error page;
 *  - a password reset issued its token and then skipped its audit row;
 *  - registering with a taken address answered 500 where a new one answered 202, which is the
 *    account-enumeration oracle that endpoint was rebuilt to close.
 *
 * Here the failure is the caller's to KNOW about and not its to PROPAGATE: the boolean says whether
 * the mail left, so a caller that has something better to do with that fact can do it.
 *
 * ## What is logged
 *
 * `MailService.send` has already logged a transport failure. This adds one line for any OTHER
 * failure, naming the subject and never the recipient or the body: the body of a reset mail is a
 * credential, and of a gift card mail it is cash.
 *
 * ## Not the queue, on purpose
 *
 * These mails carry a reset token, a sign-in code or a gift card code. The queue keeps a payload in
 * Redis for a day after success and indefinitely after failure, so routing them through it would
 * put a credential in a cache on exactly the path where something already went wrong. Each has a
 * recovery that needs no stored copy: the reset, the verification and the sign-in code are
 * requested again; a gift card's code is in the purchase response the buyer is looking at.
 */
export async function sendBestEffort(
  mail: Pick<MailService, 'send'>,
  message: OutgoingMail,
): Promise<boolean> {
  try {
    await mail.send(message);

    return true;
  } catch {
    logger.warn(
      `"${message.subject}" was not delivered; the request it belongs to stands.`,
    );

    return false;
  }
}
