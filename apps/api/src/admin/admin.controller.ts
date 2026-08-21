import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  pageQuerySchema,
  PERMISSIONS as P,
  type PageQuery,
  type PartnerTwoFactorResetInput,
  type PartnerVerifyInput,
  type PropertyReviewInput,
  type SanctionsImportInput,
  type SanctionsScreeningInput,
  partnerTwoFactorResetSchema,
  partnerVerifySchema,
  propertyReviewSchema,
  sanctionsImportSchema,
  sanctionsScreeningSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { DashboardService } from './dashboard.service.js';
import { PartnerTwoFactorService } from '../auth/partner-two-factor.service.js';
import { ReviewService } from './review.service.js';
import { SanctionsService } from '../sanctions/sanctions.service.js';
import { parseEuSanctionsXml } from '../sanctions/eu-list.parser.js';

/**
 * Staff verification endpoints (SRS §8.1, §9.2).
 *
 * Permissions are split rather than lumped under one "admin" right: approving a
 * partner (PARTNER_APPROVE) and publishing a listing (PROPERTY_APPROVE) are
 * different decisions with different blast radii, and §4.1 requires staff to hold
 * only what their role needs.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly review: ReviewService,
    private readonly dashboard: DashboardService,
    private readonly sanctions: SanctionsService,
    private readonly partnerTwoFactor: PartnerTwoFactorService,
  ) {}

  /** The §9.2 dashboard counters. */
  @Get('attention')
  @RequirePermissions(P.BOOKING_READ_ALL)
  async attention() {
    return this.review.attentionCounts();
  }

  /**
   * Everything the dashboard renders, in one round trip.
   *
   * `BOOKING_READ_ALL` matches `attention` above: the payload is counters and the five
   * most recent bookings, which every staff role that can see the dashboard can already
   * see individually.
   */
  @Get('dashboard')
  @RequirePermissions(P.BOOKING_READ_ALL)
  async dashboardOverview(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.dashboard.overview(user);
  }

  /**
   * PAGED since 2026-08-20 — see `pendingPartners` below for what the unpaged version cost.
   */
  @Get('properties/pending')
  @RequirePermissions(P.PROPERTY_APPROVE)
  async pendingProperties(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ) {
    return this.review.pendingProperties(query, user);
  }

  /** One listing's full submission (§8.1). `PROPERTY_READ`, held by support too. */
  @Get('properties/:reference')
  @RequirePermissions(P.PROPERTY_READ)
  async propertyDetail(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.review.propertyDetail(reference, user);
  }

  @Post('properties/:reference/review')
  @RequirePermissions(P.PROPERTY_APPROVE)
  async reviewProperty(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(propertyReviewSchema)) body: PropertyReviewInput,
  ) {
    return this.review.reviewProperty(user, reference, body);
  }

  /**
   * The P-002 verification queue, PAGED since 2026-08-20.
   *
   * It took no parameters and the service defaulted to fifty rows, so with 527 partners awaiting
   * verification the console could reach fifty of them and said nothing about the rest. The sidebar
   * badge counted the real figure beside a list that could not show it.
   */
  @Get('partners/pending')
  @RequirePermissions(P.PARTNER_APPROVE)
  async pendingPartners(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ) {
    return this.review.pendingPartners(query, user);
  }

  /**
   * One partner's full application (§8.1).
   *
   * `PARTNER_READ` rather than `PARTNER_APPROVE`: support agents legitimately need to
   * look up a partner while answering a ticket. The DOCUMENTS themselves are behind
   * `PARTNER_DOCUMENT_REVIEW` on their own route — this returns their metadata and
   * review state, never their bytes.
   */
  @Get('partners/:reference')
  @RequirePermissions(P.PARTNER_READ)
  async partnerDetail(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.review.partnerDetail(reference, user);
  }

  /**
   * Clear a partner's second factor so they can enrol a new authenticator (§4.1 sensitive
   * operation).
   *
   * Its own permission rather than `PARTNER_SUSPEND`, because this is the only partner action that
   * REMOVES an authentication factor — see `PARTNER_TWO_FACTOR_RESET`. The service additionally
   * refuses any target that is not a partner, so the route cannot be turned on a staff account.
   *
   * Throttled hard. There is no legitimate reason to reset several partners a minute, and a
   * compromised operations session working down a list is exactly the shape this limits.
   */
  @Post('partners/:reference/two-factor/reset')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditExempt(
    'PartnerTwoFactorService records partner.two_factor_reset transactionally.',
  )
  @RequirePermissions(P.PARTNER_TWO_FACTOR_RESET)
  async resetPartnerTwoFactor(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerTwoFactorResetSchema))
    body: PartnerTwoFactorResetInput,
  ) {
    return this.partnerTwoFactor.reset(user, reference, body.reason);
  }

  @Post('partners/:reference/verify')
  @AuditExempt(
    'ReviewService records partner.approved / partner.rejected transactionally.',
  )
  @RequirePermissions(P.PARTNER_APPROVE)
  async verifyPartner(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerVerifySchema)) body: PartnerVerifyInput,
  ) {
    return this.review.verifyPartner(user, reference, body);
  }

  /**
   * Whether the sanctions list is current enough to screen against.
   *
   * Surfaced so the console can say "the list is 9 days old" instead of a reviewer
   * discovering it as an unexplained refusal on the decision they were about to make.
   */
  @Get('sanctions/status')
  @RequirePermissions(P.PARTNER_DOCUMENT_REVIEW)
  async sanctionsStatus() {
    return this.sanctions.status();
  }

  /**
   * Imports a sanctions list body directly (ADR 0002).
   *
   * The documented fallback when `SANCTIONS_FEED_URL` is unset or the publisher's
   * token has lapsed — an operator downloads the export and posts it. Without this,
   * a rotated token would silently block every partner verification with no way to
   * recover short of a deploy.
   *
   * `SETTINGS_UPDATE`, so only `super_admin` can replace the list a legal obligation
   * is checked against. Throttled hard: it parses megabytes and writes thousands of
   * rows.
   *
   * ## The caller says WHICH list, and cannot invent one
   *
   * `source` is a required enum of two known values, so a snapshot is either the EU
   * consolidated list or a declared development fixture — nothing else, and never by
   * omission. Screening only ever asks for the former, so a fixture imported here can
   * never answer a compliance question; `SanctionsService.importSnapshot` additionally
   * refuses a fixture outright in production. Before this, the endpoint hardcoded the
   * EU source and a hand-made file became indistinguishable from the real list the
   * moment it was posted.
   */
  @Post('sanctions/import')
  @RequirePermissions(P.SETTINGS_UPDATE)
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @AuditExempt('The snapshot row itself is the record, with its content hash.')
  async importSanctionsList(
    @Body(new ZodValidationPipe(sanctionsImportSchema)) body: SanctionsImportInput,
  ) {
    const parsed = parseEuSanctionsXml(body.xml);

    return this.sanctions.importSnapshot({
      source: body.source,
      rawBody: body.xml,
      publishedAt: parsed.publishedAt,
      entries: parsed.entries,
    });
  }

  /**
   * RUNS a sanctions screening and records what it found (ADR 0002).
   *
   * Gated on document review rather than approval, because this is collecting
   * evidence rather than deciding on it — and the two are held by different roles on
   * purpose, so the person who gathers the evidence need not be the one who acts on
   * it.
   */
  @Post('partners/:reference/sanctions-screening')
  @RequirePermissions(P.PARTNER_DOCUMENT_REVIEW)
  @AuditExempt(
    'ReviewService records partner.sanctions_screened inside the screening transaction.',
  )
  async recordScreening(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(sanctionsScreeningSchema)) body: SanctionsScreeningInput,
  ) {
    return this.review.recordSanctionsScreening(user, reference, body);
  }
}
