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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import {
  PERMISSIONS as P,
  type StaffInvitationAcceptInput,
  type StaffInviteInput,
  type StaffRoleChangeInput,
  type StaffStatusInput,
  staffInvitationAcceptSchema,
  staffInviteSchema,
  staffRoleChangeSchema,
  staffStatusSchema,
  pageQuerySchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Public, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { StaffService } from './staff.service.js';

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
  constructor(private readonly staff: StaffService) {}

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
  ) {
    return this.staff.invite(user, body);
  }

  @Post(':userId/resend-invitation')
  @RequirePermissions(P.STAFF_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resend(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.staff.resendInvitation(user, userId);
  }

  @Patch(':userId/role')
  @RequirePermissions(P.STAFF_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeRole(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(staffRoleChangeSchema)) body: StaffRoleChangeInput,
  ): Promise<void> {
    await this.staff.changeRole(user, userId, body.role);
  }

  @Patch(':userId/status')
  @RequirePermissions(P.STAFF_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setStatus(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(staffStatusSchema)) body: StaffStatusInput,
  ): Promise<void> {
    await this.staff.setStatus(user, userId, body.status);
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
  ): Promise<void> {
    await this.staff.acceptInvitation(body.token, body.password);
  }
}
