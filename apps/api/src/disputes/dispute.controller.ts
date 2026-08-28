import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

import {
  disputeOpenSchema,
  disputeQuerySchema,
  type DisputeOpenInput,
  type DisputeQuery,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { DisputeRequestService } from './dispute-request.service.js';
import { DisputeEvidenceService } from './dispute-evidence.service.js';

/**
 * النزاعات, from the asking side.
 *
 * Customers only — the service refuses anyone without a customer profile, for the reason recorded
 * there. Staff have `admin/dispute.service.ts`, which is the queue, the assignment and the closing.
 */
@Controller('disputes')
export class DisputeController {
  constructor(
    private readonly disputes: DisputeRequestService,
    private readonly evidence: DisputeEvidenceService,
  ) {}

  @Get()
  @AuditExempt('Reading your own disputes; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(disputeQuerySchema)) query: DisputeQuery,
  ) {
    return this.disputes.list(user, query);
  }

  /**
   * The bookings this customer could raise a dispute about.
   *
   * A separate read rather than a field on the booking list, because the form needs exactly this
   * question answered — and answering it here means the RULE for what is disputable lives beside the
   * rule that enforces it, instead of being reimplemented in a picker.
   */
  @Get('disputable-bookings')
  @AuditExempt('Reading your own bookings; changes nothing.')
  async disputable(@CurrentUser() user: AccessTokenClaims | undefined) {
    return { items: await this.disputes.disputableBookings(user) };
  }

  @Get(':reference')
  @AuditExempt('Reading one of your own disputes; changes nothing.')
  async detail(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.disputes.detail(user, reference);
  }

  /**
   * Raising one.
   *
   * Throttled hard — harder than opening a support ticket, which is six a minute. A dispute FREEZES
   * the partner's payout for that booking, so a loop here does not merely fill a queue: it stops
   * somebody being paid. Three a minute is generous for a person with a genuine complaint about a
   * stay and useless for anything else.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  @AuditExempt('The dispute row IS the record, and it names who opened it.')
  async open(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(disputeOpenSchema)) body: DisputeOpenInput,
  ) {
    return this.disputes.open(user, body);
  }

  /**
   * A photograph on the caller's own dispute — EC-007's, above all.
   *
   * Multipart and held in memory like every other upload here: sharp needs the whole buffer, and a
   * temporary file would be one more place an unvalidated upload could sit. The 10MB ceiling is the
   * same one, and `ImageService.inspect` refuses anything that is not a photograph before a byte
   * reaches storage.
   *
   * Throttled at ten a minute rather than three: attaching pictures is not opening disputes, and
   * somebody photographing a room takes several. It moves no money.
   */
  @Post(':reference/evidence')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt('DisputeEvidenceService records dispute.evidence_added transactionally.')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }),
  )
  async addEvidence(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    return this.evidence.addAsCustomer(user, reference, file);
  }

  /**
   * The bytes of one of the caller's own photographs.
   *
   * Streamed under authorisation for the reason the staff route gives: this prefix is not in the
   * bucket's anonymous read policy, and it must not be.
   */
  @Get('evidence/:evidenceId/file')
  @AuditExempt('Reading one’s own evidence changes nothing.')
  async evidenceFile(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Res() response: Response,
  ) {
    const file = await this.evidence.readFile(evidenceId, user, 'customer');

    response
      .setHeader('Content-Type', file.contentType)
      .setHeader('Content-Disposition', 'inline')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('Cache-Control', 'private, no-store')
      .send(file.bytes);
  }
}
