import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import {
  ERROR,
  PERMISSIONS as P,
  adInvoicePaySchema,
  advertiserCreateSchema,
  campaignCreateSchema,
  campaignUpdateSchema,
  pageQuerySchema,
  staffDisputeOpenSchema,
  type AdInvoicePayInput,
  type AdvertiserCreateInput,
  type CampaignCreateInput,
  type CampaignUpdateInput,
  type StaffDisputeOpenInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { notFound } from '../common/errors/app-error.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { AdCreativeService } from './ad-creative.service.js';
import { AdManagementService } from './ad-management.service.js';
import { AdInvoiceService } from './ad-invoice.service.js';
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
    private readonly adManagement: AdManagementService,
    private readonly adCreative: AdCreativeService,
    private readonly adInvoices: AdInvoiceService,
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

  /**
   * Staff open a dispute on a booking — §9.4's «فتح نزاع», from the booking screen.
   *
   * `DISPUTE_MANAGE`, the same capability closing takes: recording a complaint and deciding one
   * are both the dispute desk's work, and a role that may close but not open would be unable to
   * take the telephone call that starts the case.
   *
   * Throttled harder than closing, and for the reason the customer's own route is: a dispute
   * FREEZES the partner's payout for that booking, so a loop here does not merely fill a queue —
   * it stops somebody being paid.
   */
  @Post('disputes')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.DISPUTE_MANAGE)
  @AuditExempt('DisputeService records dispute.opened_by_staff inside the transaction.')
  async openDispute(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(staffDisputeOpenSchema)) body: StaffDisputeOpenInput,
  ) {
    return this.disputes.openForBooking(user, body);
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
  async thread(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    /* Scoped by the booking's city, or the partner's where there is no booking. */
    return { messages: await this.messaging.thread(reference, user) };
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

  /** Creating an advertiser — the business that pays. Distinct from a partner, who sells. */
  @Post('advertisers')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(P.AD_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuditExempt('AdManagementService records advertiser.created inside the transaction.')
  async createAdvertiser(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(advertiserCreateSchema)) body: AdvertiserCreateInput,
  ) {
    return this.adManagement.createAdvertiser(user, body);
  }

  /**
   * Creating a campaign — §9.3's «+ حملة جديدة».
   *
   * Issues every invoice the campaign will be billed for, in the same transaction: a campaign whose
   * window is fixed has no periods left for a job to discover, and a job that generates them is one
   * that can fail silently and leave a month unbilled.
   */
  @Post('ad-campaigns')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(P.AD_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuditExempt('AdManagementService records ad_campaign.created inside the transaction.')
  async createCampaign(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(campaignCreateSchema)) body: CampaignCreateInput,
  ) {
    return this.adManagement.createCampaign(user, body);
  }

  /**
   * The creative IMAGE, through the same pipeline every other picture on the platform uses.
   *
   * Multipart, held in memory like the listing upload: sharp needs the whole buffer, and a temp
   * file would be one more place an unvalidated upload could sit. The 10MB ceiling is the same one,
   * and `ImageService.inspect` refuses anything that is not a photograph before a byte is stored.
   */
  @Post('ad-campaigns/:reference/creative')
  @RequirePermissions(P.AD_MANAGE)
  @AuditExempt('AdCreativeService records ad_campaign.creative_uploaded transactionally.')
  /* Image processing is CPU-heavy, so the budget is tighter than the global one. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }),
  )
  async uploadCreative(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
  ) {
    return this.adCreative.upload(user, reference, file);
  }

  /** Editing the creative. The window and the price are not editable — see the contract. */
  @Patch('ad-campaigns/:reference')
  @RequirePermissions(P.AD_MANAGE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @AuditExempt('AdManagementService records ad_campaign.updated inside the transaction.')
  async updateCampaign(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(campaignUpdateSchema)) body: CampaignUpdateInput,
  ) {
    await this.adManagement.updateCampaign(user, reference, body);

    return { ok: true };
  }

  /** What advertisers owe, scoped by the campaign's city. */
  @Get('ad-invoices')
  @RequirePermissions(P.AD_READ)
  async listAdInvoices(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.adInvoices.list({ ...query, actor: user });
  }

  /**
   * Recording that an advertiser paid — the moment the revenue reaches the books.
   *
   * `AD_MANAGE` rather than a finance permission, deliberately: whoever runs the campaign is who
   * knows it was paid for. The ledger pair is posted in the same transaction.
   */
  @Post('ad-invoices/:reference/paid')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.AD_MANAGE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @AuditExempt('AdInvoiceService records ad_invoice.paid inside the transaction.')
  async markInvoicePaid(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(adInvoicePaySchema)) body: AdInvoicePayInput,
  ) {
    await this.adInvoices.markPaid(user, reference, body.note);

    return { ok: true };
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
    /* The actor, because the list is SCOPED — see `PartnerContractService.list`. */
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(
      new ZodValidationPipe(
        z.object({ partner: z.string().trim().max(32).optional() }).strict(),
      ),
    )
    query: {
      partner?: string | undefined;
    },
  ) {
    return { contracts: await this.contracts.list(user, query.partner) };
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
  /*
    `ParseUUIDPipe` on every contract id below (2026-08-23).

    These took the id raw and interpolated it into `${id}::uuid`. The bind is parameterised, so
    this was never injectable — but a malformed id reached Postgres, raised «invalid input syntax
    for type uuid», and came back to the caller as an unhandled 500 with a database error in the
    log. A 400 with a code is the honest answer, and a probe gets nothing back either way. The
    partner-side route already did this; the console's five did not.
  */
  @Post('partner-contracts/:id/signed-copy')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async uploadSafraSignedCopy(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
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
   * ONE scan carrying BOTH signatures, filed by staff — the in-person onboarding path.
   *
   * Available only while the partner is still being ADDED (Bashar, 2026-08-23). That is enforced
   * in the service, from the predicate the console reads to decide whether to show the button, so
   * a hidden control and a refused request are never in disagreement. The permission is the same
   * one that governs every other contract write; the boundary here is the partner's state, not the
   * caller's role.
   */
  @Post('partner-contracts/:id/joint-signed-copy')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async uploadJointSignedCopy(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(signedCopySchema)) body: SignedCopyInput,
    @Req() request: { ip?: string; headers: Record<string, unknown> },
  ) {
    return {
      contracts: await this.contracts.uploadJointSignedCopy(user, id, body, {
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { contracts: await this.contracts.reopenForPartner(user, id) };
  }

  /** Records the partner's signature, which is what makes a contract `active`. */
  @Patch('partner-contracts/:id/signed')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_CONTRACT_MANAGE)
  async markContractSigned(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(signedSchema)) body: z.infer<typeof signedSchema>,
  ) {
    return { contracts: await this.contracts.markSigned(user, id, body.signedOn) };
  }
}
