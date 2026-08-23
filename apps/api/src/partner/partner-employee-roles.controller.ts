import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  employeeRoleCreateSchema,
  PERMISSIONS as P,
  type EmployeeRoleCreateInput,
} from '@safra/contracts';

import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { requirePartnerId } from '../rbac/ownership.js';
import { PartnerEmployeeRolesService } from './partner-employee-roles.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A PARTNER's own employee-role catalogue (Bashar, 2026-08-23).
 *
 * ## Why every route carries `PARTNER_EMPLOYEE_MANAGE`, the partner's own permission
 *
 * SAFRA does not administer this. Bashar, 2026-08-23: *"The super admin has nothing to do with the
 * partner role definitions / employees. The partner should be able to invite his own employees and
 * also define their roles himself."* The same permission governs inviting an employee and defining
 * the roles they can hold, because they are one job done by one person — the owner of the business.
 *
 * The platform's only involvement is the BOUND: a role can never carry more than
 * `PARTNER_EMPLOYEE_PERMISSIONS`, which is a subset of what a partner itself holds. That is a
 * safety invariant, not an administrative one — it stops an employee out-ranking their employer,
 * and no staff member decides anything about it.
 *
 * ## The assignable list is SERVED, not published as a constant for the screen to copy
 *
 * `GET .../assignable` exists so the console builds its checkboxes from the same source the API
 * validates against. A hand-written list on the screen would offer capabilities the API rejects,
 * which is the disagreement between a form and its endpoint that this codebase keeps eliminating.
 */
@Controller('partner/employee-roles')
export class PartnerEmployeeRolesController {
  constructor(private readonly roles: PartnerEmployeeRolesService) {}

  @Get()
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async list(@CurrentUser() user: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { roles: await this.roles.list(partnerId) };
  }

  /** What a role MAY carry. The console renders one checkbox per entry. */
  @Get('assignable')
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  assignable(@CurrentUser() user: AccessTokenClaims | undefined) {
    requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { permissions: this.roles.assignablePermissions() };
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async create(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(employeeRoleCreateSchema)) body: EmployeeRoleCreateInput,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { roles: await this.roles.create(user, partnerId, body) };
  }

  /*
    PUT rather than PATCH: the body carries the WHOLE role. A partial update of a permission set is
    ambiguous in a way that matters — "permissions: [booking.read_own]" could mean "only this one"
    or "add this one", and the two differ by everything the role could already do.
  */
  @Put(':id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(employeeRoleCreateSchema)) body: EmployeeRoleCreateInput,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { roles: await this.roles.update(user, partnerId, id, body) };
  }

  @Delete(':id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_EMPLOYEE_MANAGE)
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_EMPLOYEE_MANAGE);

    return { roles: await this.roles.remove(user, partnerId, id) };
  }
}
