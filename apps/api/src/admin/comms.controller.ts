import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { ERROR, PERMISSIONS as P, pageQuerySchema } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { notFound } from '../common/errors/app-error.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import {
  DisputeService,
  closeDisputeSchema,
  type CloseDisputeInput,
} from './dispute.service.js';
import {
  MessagingService,
  staffReplySchema,
  type StaffReplyInput,
} from './messaging.service.js';
import {
  AdvertisingService,
  campaignStatusSchema,
  type CampaignStatusInput,
} from './advertising.service.js';
import {
  PartnerContractService,
  generateContractSchema,
  signedCopySchema,
  uploadContractSchema,
  type GenerateContractInput,
  type SignedCopyInput,
  type UploadContractInput,
} from './partner-contract.service.js';
import { NOTIFICATION_TEMPLATES } from './notification-templates.js';

const listQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
});

const disputeQuerySchema = listQuerySchema.extend({
  status: z.enum(['open', 'investigating', 'resolved', 'rejected']).optional(),
});

const notificationQuerySchema = listQuerySchema.extend({
  status: z.enum(['queued', 'sent', 'delivered', 'failed']).optional(),
});

const signedSchema = z
  .object({
    /** The date on the signature, not today: a contract is often filed days after signing. */
    signedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Signature date must be YYYY-MM-DD.'),
  })
  .strict();

/**
 * The four sections that were blocked on schema until 2026-08-04: disputes, conversations, the
 * WhatsApp/email log and advertising — plus partner contracts (design handoff §8, §8.1).
 *
 * ## Why a third admin controller
 *
 * `AdminController` owns verification decisions; `RegistriesController` owns registry and finance
 * reads. This owns the customer-facing and commercial domains, which are the ones with WRITE paths
 * that move money or affect an advertiser's paid window. Keeping those in a file of their own means
 * the routes that can credit a wallet stay reviewable in one sitting.
 *
 * ## Permissions are per resource
 *
 * `dispute.read` and `dispute.manage` differ: a support agent investigates and closes, and that
 * closure can credit a wallet. `notification.read` is deliberately separate from `message.read` —
 * finance needs to confirm an invoice was delivered without being able to read the conversation.
 */
@Controller('admin')
export class CommsController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly messaging: MessagingService,
    private readonly advertising: AdvertisingService,
    private readonly contracts: PartnerContractService,
  ) {}

  // ── النزاعات ───────────────────────────────────────────────────────────────

  @Get('disputes')
  @RequirePermissions(P.DISPUTE_READ)
  async listDisputes(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(disputeQuerySchema))
    query: z.infer<typeof disputeQuerySchema>,
  ) {
    const [page, counters] = await Promise.all([
      this.disputes.list({ ...query, actor: user }),
      this.disputes.counters(user),
    ]);

    return { ...page, counters };
  }

  /**
   * Which bookings currently have their partner payout frozen.
   *
   * `PAYOUT_READ`, not `DISPUTE_READ`: the question this answers is a finance question — what may
   * not be paid out this week — and the answer is derived from disputes rather than owned by them.
   */
  @Get('disputes/frozen-payouts')
  @RequirePermissions(P.PAYOUT_READ)
  async frozenPayouts(@CurrentUser() user: AccessTokenClaims | undefined) {
    return { bookings: await this.disputes.frozenBookingReferences(user) };
  }

  /**
   * Closes a dispute. Throttled because it can credit a wallet.
   *
   * Not about brute force — the caller is authenticated and permissioned. It bounds the damage of
   * a stuck retry loop crediting the same customer repeatedly.
   */
  @Post('disputes/:reference/close')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.DISPUTE_MANAGE)
  async closeDispute(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(closeDisputeSchema)) body: CloseDisputeInput,
  ) {
    return this.disputes.close(user, reference, body);
  }

  // ── الرسائل ────────────────────────────────────────────────────────────────

  @Get('conversations')
  @RequirePermissions(P.MESSAGE_READ)
  async listConversations(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.messaging.conversations({ ...query, actor: user });
  }

  @Get('conversations/:reference')
  @RequirePermissions(P.MESSAGE_READ)
  async thread(@Param('reference') reference: string) {
    return { messages: await this.messaging.thread(reference) };
  }

  @Post('conversations/:reference/reply')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @RequirePermissions(P.MESSAGE_SEND)
  async reply(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(staffReplySchema)) body: StaffReplyInput,
  ) {
    return { messages: await this.messaging.reply(user, reference, body) };
  }

  // ── واتساب والبريد ─────────────────────────────────────────────────────────

  @Get('notifications')
  @RequirePermissions(P.NOTIFICATION_READ)
  async listNotifications(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(notificationQuerySchema))
    query: z.infer<typeof notificationQuerySchema>,
  ) {
    const [page, counters] = await Promise.all([
      this.messaging.notifications({ ...query, actor: user }),
      this.messaging.notificationCounters(),
    ]);

    /*
      The template inventory is CODE, not data — a template that exists in the catalogue but has
      never been sent must still appear on the screen, which a query over the log cannot do.
    */
    return { ...page, counters, templates: NOTIFICATION_TEMPLATES };
  }

  // ── الإعلانات ──────────────────────────────────────────────────────────────

  @Get('ad-campaigns')
  @RequirePermissions(P.AD_READ)
  async listCampaigns(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    const [page, counters] = await Promise.all([
      this.advertising.list({ ...query, actor: user }),
      this.advertising.counters(user),
    ]);

    return { ...page, counters };
  }

  @Patch('ad-campaigns/:reference/status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions(P.AD_MANAGE)
  async setCampaignStatus(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(campaignStatusSchema)) body: CampaignStatusInput,
  ) {
    return this.advertising.setStatus(user, reference, body);
  }

  // ── عقود الشراكة ───────────────────────────────────────────────────────────

  @Get('partner-contracts')
  @RequirePermissions(P.PARTNER_CONTRACT_READ)
  async listContracts(
    @Query(
      new ZodValidationPipe(
        z.object({ partner: z.string().trim().max(32).optional() }).strict(),
      ),
    )
    query: {
      partner?: string | undefined;
    },
  ) {
    return { contracts: await this.contracts.list(query.partner) };
  }

  /**
   * Uploads a signed contract.
   *
   * Base64 in a JSON body rather than multipart, matching how partner documents already arrive:
   * one validation pipe covers the whole request, and there is no multipart parser in the
   * dependency tree to keep patched. The 10MB ceiling is enforced by the schema, by a byte-length
   * check, and by a database CHECK.
   */
  @Post('partner-contracts')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async uploadContract(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(uploadContractSchema)) body: UploadContractInput,
  ) {
    return { contracts: await this.contracts.upload(user, body) };
  }

  /**
   * Generates the partnership agreement from SAFRA's template (Bashar, 2026-08-21).
   *
   * Step 4 of «انضم كشريك». The document is produced, hashed and stored as a `draft`; nobody has
   * signed anything yet. Throttled well below the upload endpoint because each call renders a PDF
   * in a headless browser, which is expensive in a way a JSON write is not.
   */
  @Post('partner-contracts/generate')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async generateContract(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(generateContractSchema)) body: GenerateContractInput,
  ) {
    return {
      contracts: await this.contracts.generate(user, body.partnerReference, body.kind),
    };
  }

  /**
   * SAFRA's hand-signed copy, which is what SENDS the contract to the partner.
   *
   * Electronic signatures are not accepted in Syria (Bashar, 2026-08-21), so signing is on paper:
   * staff download the generated PDF, sign it, scan it and upload it here. That upload moves the
   * contract to `awaiting_partner_signature` and emails the partner.
   */
  @Post('partner-contracts/:id/signed-copy')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async uploadSafraSignedCopy(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(signedCopySchema)) body: SignedCopyInput,
    @Req() request: { ip?: string; headers: Record<string, unknown> },
  ) {
    return {
      contracts: await this.contracts.uploadSafraSignedCopy(user, id, body, {
        ipAddress: request.ip,
        userAgent:
          typeof request.headers['user-agent'] === 'string'
            ? request.headers['user-agent']
            : undefined,
      }),
    };
  }

  /**
   * The contract file itself — needed because staff must print it to sign it.
   *
   * `attachment` and `nosniff`, exactly as the partner's download does: `inline` would render a
   * commercial agreement inside the console's own origin, and a PDF viewer is a scripting surface.
   */
  @Get('partner-contracts/:id/file/:party')
  @RequirePermissions(P.PARTNER_CONTRACT_READ)
  @AuditExempt('PartnerContractService records partner_contract.viewed.')
  async downloadContract(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Param('party') party: string,
    @Res() response: Response,
  ) {
    /*
      An unknown party names no file, so it is answered as one that does not exist rather than as
      a bad request. That also keeps the three-value list in one place: the service refuses
      anything else too, and this is the same refusal made cheap.
    */
    if (party !== 'original' && party !== 'safra' && party !== 'partner') {
      throw notFound(ERROR.CONTRACT_NOT_FOUND);
    }

    const file = await this.contracts.readFile(user, id, party);

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`,
    );
    response.send(file.body);
  }

  /**
   * Hands the signing step back to the partner (Bashar, 2026-08-21).
   *
   * For when the partner uploaded the wrong scan and the two of them have spoken. Their first
   * attempt is superseded rather than removed, the contract returns to
   * `awaiting_partner_signature`, and they are emailed again.
   */
  @Post('partner-contracts/:id/reopen')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async reopenContract(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ) {
    return { contracts: await this.contracts.reopenForPartner(user, id) };
  }

  /** Records the partner's signature, which is what makes a contract `active`. */
  @Patch('partner-contracts/:id/signed')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async markContractSigned(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(signedSchema)) body: z.infer<typeof signedSchema>,
  ) {
    return { contracts: await this.contracts.markSigned(user, id, body.signedOn) };
  }
}
