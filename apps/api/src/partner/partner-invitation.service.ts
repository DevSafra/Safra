import { Inject, Injectable } from '@nestjs/common';

import { AuthTokenService } from '../auth/auth-token.service.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { partnerInvitationMail } from '../mail/mail.templates.js';

/**
 * How long an invitation link lives.
 *
 * Seventy-two hours: an invitation is EXPECTED, unlike a password reset, and the recipient has
 * either just been telephoned or has just been sitting across a table from the person who sent it
 * — but it is also the only thing standing between an inbox and a partner account, so it does not
 * live for a week.
 */
export const PARTNER_INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * The one way a partner invitation is issued and sent.
 *
 * ## Why this is a service rather than a private method
 *
 * It was a private method on `PartnerApplicationService`, which was correct while accepting a
 * request was the only route to a partner account. Onboarding a partner in person (Bashar,
 * 2026-08-23) is a second route, and a second copy of these eight lines is how the two start
 * disagreeing about the thing that matters here: the LIFETIME of the link, and which URL it points
 * at.
 *
 * That divergence would not announce itself. Both copies would keep working; they would simply
 * hand out links that expire at different times, and the first anybody would learn of it is a
 * partner ringing to say theirs stopped working sooner than the email promised.
 *
 * ## What it does not decide
 *
 * Nothing about eligibility. Whether this account MAY become a partner is a question about roles
 * and existing partner rows, and it is answered by the caller before it gets here — twice over, in
 * fact, because it is asked again at redemption. This only issues a token and posts a link.
 */
@Injectable()
export class PartnerInvitationService {
  constructor(
    private readonly authTokens: AuthTokenService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Issues a single-use link and mails it.
   *
   * `to` is passed rather than read from the account on purpose: an application records the
   * address it was FILED with, and "where SAFRA wrote" is the thing the record should be able to
   * answer later — not where that account's address has since moved to.
   *
   * The URL is built from the configured `PARTNER_URL`, never from a request. A link assembled
   * out of a `Host` header is a redirect to wherever the request said, mailed by us.
   */
  async send(input: {
    userId: string;
    to: string;
    partnerReference: string;
    locale: string;
  }): Promise<void> {
    const { token } = await this.authTokens.issue(
      input.userId,
      'partner_invitation',
      PARTNER_INVITATION_TTL_MS,
    );

    await this.mail.send(
      partnerInvitationMail({
        to: input.to,
        reference: input.partnerReference,
        url: new URL(`/invitation/${token}`, this.env.PARTNER_URL).toString(),
        locale: input.locale,
        expiresInHours: PARTNER_INVITATION_TTL_MS / 3_600_000,
      }),
    );
  }
}
