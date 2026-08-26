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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import {
  ERROR,
  PERMISSIONS as P,
  type StaffInvitationAcceptInput,
  type StaffInviteInput,
  type StaffProfileInput,
  type StaffRoleAssignInput,
  type StaffStatusInput,
  staffInvitationAcceptSchema,
  staffInviteSchema,
  staffProfileSchema,
  staffRoleAssignSchema,
  staffStatusSchema,
  pageQuerySchema,
} from '@safra/contracts';

import type { Request } from 'express';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Public, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditLogService } from './audit-log.service.js';
import { notFound } from '../common/errors/app-error.js';
import { StaffService } from './staff.service.js';

const staffActivityQuerySchema = pageQuerySchema.extend({
  /** A name or an email, matched as a substring. Bounded so it cannot become a payload. */
  q: z.string().trim().min(1).max(120).optional(),
});

/**
 * Staff account management (M-5, SRS §4, §9.3).
 *
 * Every route requires `STAFF_MANAGE`, which only `super_admin` holds. Granting
 * console access is the most consequential thing anybody can do on this platform —
 * it is how every other permission is handed out — so it is deliberately not
 * delegable to `operations_manager`.
 */
@Controller('admin/staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * A page of staff accounts.
   *
   * Shape changed 2026-08-05 from `{ staff: [...] }` to a numbered page. The old form returned
   * every row, which rule 2 has forbidden on list endpoints since the project started — a staff
   * list sounds small, and it is 165 rows on the development database and grows with the company.
   *
   * `staff` is kept as an alias for `items` so the console's schema and any other reader keep
   * working through the change; both name the same array.
   */
  @Get()
  @RequirePermissions(P.STAFF_MANAGE)
  async list(
    @Query(new ZodValidationPipe(pageQuerySchema))
    query: z.infer<typeof pageQuerySchema>,
  ) {
    const page = await this.staff.list(query);

    /*
      Spread, rather than listing the fields: an enumerated copy silently drops any field the page
      shape grows later, and the client's schema then rejects a 200 as a failed load. That already
      happened once, when `capped` was added.
    */
    return { ...page, staff: page.items };
  }

  /**
   * آخر نشاط الموظفين — paged, and searchable by the person who acted.
   *
   * ## Paged, not lazily loaded
   *
   * Bashar offered either (2026-08-24). Paged, because his own standing instruction is that every
   * console list carries `TablePagination` — a page NUMBER the reader chooses and a rows-per-page
   * they choose — and an infinite list has neither. The max height he asked for is the panel
   * scrolling inside its own box, which is a separate thing and compatible with both.
   *
   * ## Declared BEFORE `:userId`
   *
   * `activity` is a literal segment on a controller that also has `@Get(':userId')`. Express
   * matches in declaration order, so this must come first or `ParseUUIDPipe` answers 400 for a
   * route that exists. Same hazard as `staff/overview` one level up — see `staff-order.test.ts`.
   */
  @Get('activity')
  @RequirePermissions(P.STAFF_MANAGE)
  @AuditExempt(
    'Reading the trail; changes nothing, and reading it is itself not recorded.',
  )
  async activity(
    @Query(new ZodValidationPipe(staffActivityQuerySchema))
    query: z.infer<typeof staffActivityQuerySchema>,
  ) {
    return this.audit.staffActivity({
      limit: query.limit,
      page: query.page,
      actorSearch: query.q,
    });
  }

  /**
   * One entry, explaining what changed.
   *
   * A 404 for an id that names a customer's or a partner's action, not only for one that names
   * nothing — this screen is reached with `staff.manage`, and `audit_log.read` is a different
   * capability that opens the whole trail.
   */
  @Get('activity/:id')
  @RequirePermissions(P.STAFF_MANAGE)
  @AuditExempt('Reading one entry; changes nothing.')
  async activityEntry(@Param('id', ParseUUIDPipe) id: string) {
    const entry = await this.audit.staffEntry(id);

    if (!entry) throw notFound(ERROR.AUDIT_ENTRY_NOT_FOUND);

    return entry;
  }

  /**
   * One staff account — the screen «رجوع» comes back from.
   *
   * ## The route is `:userId` and two SIBLING routes are static
   *
   * `GET /admin/staff/overview` and `GET /admin/staff/scopes` live on `RegistriesController`, which
   * `AdminModule` registers BEFORE this controller. Express matches in registration order, so those
   * two win and this parameterised route never sees them. Reorder that array and `overview` starts
   * arriving here as a `userId`, where `ParseUUIDPipe` answers 400 — the console then renders the
   * page with its counters silently missing, because a failed panel is rendered as nothing.
   *
   * `staff-order.test.ts` holds that ordering to account, since nothing else would notice.
   */
  @Get(':userId')
  @RequirePermissions(P.STAFF_MANAGE)
  @AuditExempt('Reading one staff account; changes nothing.')
  async detail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.staff.detail(userId);
  }

  /**
   * Invites a staff member. Throttled hard: it sends mail to an
   * attacker-chosen address, so an unthrottled version is a spam relay that happens
   * to require a super-admin session.
   */
  @Post()
  @RequirePermissions(P.STAFF_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async invite(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(staffInviteSchema)) body: StaffInviteInput,
    @Req() request: Request,
  ) {
    return this.staff.invite(user, body, origin(request));
  }

  @Post(':userId/resend-invitation')
  @RequirePermissions(P.STAFF_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resend(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.staff.resendInvitation(user, userId, origin(request));
  }

  /**
   * Names a staff account. `PATCH :userId`, because the person IS the resource.
   *
   * Separate from the role and status patches: naming somebody changes nothing about what they may
   * do, and folding it in would mean sending a role in order to correct a spelling.
   */
  @Patch(':userId')
  @RequirePermissions(P.STAFF_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async rename(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(staffProfileSchema)) body: StaffProfileInput,
    @Req() request: Request,
  ) {
    await this.staff.rename(user, userId, body.fullName, origin(request));

    return this.staff.detail(userId);
  }

  @Patch(':userId/role')
  @RequirePermissions(P.STAFF_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeRole(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(staffRoleAssignSchema)) body: StaffRoleAssignInput,
    @Req() request: Request,
  ): Promise<void> {
    await this.staff.changeRole(user, userId, body.staffRoleId, origin(request));
  }

  @Patch(':userId/status')
  @RequirePermissions(P.STAFF_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setStatus(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(staffStatusSchema)) body: StaffStatusInput,
    @Req() request: Request,
  ): Promise<void> {
    await this.staff.setStatus(user, userId, body.status, origin(request));
  }
}

/**
 * Accepting an invitation.
 *
 * A separate controller because this one route is `@Public()` — the recipient has no
 * session yet, and the token is the authentication. Keeping it out of the
 * permission-gated controller above means the exemption is visible rather than an
 * easily-missed decorator among guarded siblings.
 */
@Controller('auth/staff-invitation')
export class StaffInvitationController {
  constructor(private readonly staff: StaffService) {}

  /**
   * Throttled per IP. The token is 256 bits of randomness so guessing is not the
   * threat; the limit is there because this endpoint runs Argon2id, which is
   * expensive by design and therefore a cheap way to burn CPU.
   */
  @Public()
  @Post('accept')
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('StaffService records staff.invitation_accepted for the redeeming user.')
  async accept(
    @Body(new ZodValidationPipe(staffInvitationAcceptSchema))
    body: StaffInvitationAcceptInput,
    @Req() request: Request,
  ): Promise<void> {
    await this.staff.acceptInvitation(body.token, body.password, origin(request));
  }
}

/**
 * Where a request came from — §15's «تسجيل IP والجهاز» on a sensitive operation.
 *
 * These routes are `@AuditExempt` because `StaffService` records them itself: it knows the role a
 * staff member held BEFORE the change, which an interceptor reading the response cannot. The cost
 * is that the service has no request to read, so the controller hands it over — the same shape
 * `bookings.controller.ts` uses for booking creation.
 */
function origin(request: Request): {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
} {
  return { ipAddress: request.ip, userAgent: request.get('user-agent') };
}
