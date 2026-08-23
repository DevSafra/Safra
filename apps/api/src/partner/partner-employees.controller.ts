import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  cursorQuerySchema,
  employeeInvitationAcceptSchema,
  employeeInviteSchema,
  employeeUpdateSchema,
  PERMISSIONS as P,
  type CursorQuery,
  type EmployeeInvitationAcceptInput,
  type EmployeeInviteInput,
  type EmployeeUpdateInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CurrentUser, Public, RequirePermissions } from '../rbac/decorators.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { PartnerEmployeesService } from './partner-employees.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A partner managing its own staff (Bashar, 2026-08-23).
 *
 * ## The partner id comes from the TOKEN on every route
 *
 * `requirePartnerId` derives it from the verified claims; nothing here reads a partner id from a
 * request. "Manage another business's employees" is not a request this controller can express,
 * which is a stronger property than refusing it.
 *
 * ## `PARTNER_EMPLOYEE_MANAGE` is held by the partner and NOT by its employees
 *
 * Deliberately absent from `PARTNER_EMPLOYEE_PERMISSIONS`. A receptionist who could hire, promote
 * or suspend would be able to promote themselves — the one permission that, granted to an
 * employee, dissolves every other boundary in this feature.
 */
@Controller('partner/employees')
export class PartnerEmployeesController {
  constructor(private readonly employees: PartnerEmployeesService) {}

  /*
    Cursor-paginated, like every other partner-facing list. A partner's staff count is a fact about
    THEIR business rather than ours, so it cannot be bounded by an assumption of ours — see
    `PartnerEmployeesService.list`.
  */
  @Get()
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return this.employees.list(partnerId, query);
  }

  /** The role catalogue, so the screen can offer what a super admin has defined. */
  @Get('roles')
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async roles(@CurrentUser() user: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { roles: await this.employees.assignableRoles(partnerId) };
  }

  /*
    Throttled harder than the reads: this one sends mail to an address the caller chose, so an
    unbounded version is a way to use the platform to post at somebody.
  */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async invite(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(employeeInviteSchema)) body: EmployeeInviteInput,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { employees: await this.employees.invite(user, partnerId, body) };
  }

  @Patch(':id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(employeeUpdateSchema)) body: EmployeeUpdateInput,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { employees: await this.employees.update(user, partnerId, id, body) };
  }

  @Delete(':id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { employees: await this.employees.remove(user, partnerId, id) };
  }
}

/**
 * Activating an invited employee's account.
 *
 * Its own controller, for the same reason `PartnerInvitationController` is separate from the queue
 * endpoints: this is the only `@Public()` route in the employees feature, and a public route in a
 * file of permission-guarded ones is easy to miss when reading either.
 */
@Controller('partner/employee-invitation')
export class PartnerEmployeeInvitationController {
  constructor(
    private readonly employees: PartnerEmployeesService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Throttled at five a minute. The token is 256 bits, so guessing is not the threat — the limit
   * answers somebody spending an Argon2id hash per request, which is the expensive part.
   */
  @Public()
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditExempt('PartnerEmployeesService records partner_employee.activated itself.')
  async accept(
    @Body(new ZodValidationPipe(employeeInvitationAcceptSchema))
    body: EmployeeInvitationAcceptInput,
  ) {
    /*
      Hashed HERE and passed in, so the service never holds a clear password. The service owns the
      state machine; hashing is the auth module's job and there is one Argon2id cost in the app.
    */
    await this.employees.acceptInvitation(
      body.token,
      await this.passwords.hash(body.password),
    );

    /*
      No session is issued and nothing about the account is echoed back. They sign in normally,
      which keeps one code path minting employee sessions.
    */
    return { ok: true };
  }
}
