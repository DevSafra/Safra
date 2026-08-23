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
  PERMISSIONS as P,
  staffRoleCreateSchema,
  type StaffRoleCreateInput,
} from '@safra/contracts';

import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { StaffRolesService } from './staff-roles.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The super admin's own staff-role catalogue (Bashar, 2026-08-23).
 *
 * The console's counterpart to the partner portal's `/partner/employee-roles`. Same screen, same
 * shape, different population: a partner names the jobs in their business, the super admin names
 * the jobs in this one, and neither administers the other.
 *
 * ## `STAFF_ROLE_MANAGE`, and why it is not `STAFF_MANAGE`
 *
 * Adding a person to a role and deciding what a role can do are different powers. The second is the
 * one that can be turned on itself: a role holding this permission can edit its own row and become
 * a super admin in one save, which is why no named role may carry it at all.
 */
@Controller('admin/staff-roles')
export class StaffRolesController {
  constructor(private readonly roles: StaffRolesService) {}

  @Get()
  @RequirePermissions(P.STAFF_ROLE_MANAGE)
  async list() {
    return { roles: await this.roles.list() };
  }

  /** What a role MAY carry. The console renders one checkbox per entry. */
  @Get('assignable')
  @RequirePermissions(P.STAFF_ROLE_MANAGE)
  assignable() {
    return { permissions: this.roles.assignablePermissions() };
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.STAFF_ROLE_MANAGE)
  async create(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(staffRoleCreateSchema)) body: StaffRoleCreateInput,
  ) {
    return { roles: await this.roles.create(user, body) };
  }

  /*
    PUT, not PATCH: the body carries the WHOLE role. A partial permission set is ambiguous in a way
    that matters — `[booking.read_own]` could mean "only this" or "add this", and the two differ by
    everything the role could already do.
  */
  @Put(':id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.STAFF_ROLE_MANAGE)
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(staffRoleCreateSchema)) body: StaffRoleCreateInput,
  ) {
    return { roles: await this.roles.update(user, id, body) };
  }

  @Delete(':id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.STAFF_ROLE_MANAGE)
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { roles: await this.roles.remove(user, id) };
  }
}
