import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { PERMISSIONS as P, pageQuerySchema } from '@safra/contracts';

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
  uploadContractSchema,
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
