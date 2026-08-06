import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';

import { type TablePageSizeInput, tablePageSizeSchema } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { MeService } from './me.service.js';

/**
 * What the signed-in staff member has chosen for themselves.
 *
 * ## Why this needs no permission
 *
 * Every other admin route carries `@RequirePermissions`, and this one deliberately does not.
 * Authentication is opt-OUT in this codebase — `JwtAuthGuard` is global — so these routes are
 * still closed to anonymous callers; they are simply open to every staff role, because the
 * subject is the CALLER and nothing else. A support agent choosing to see fifty rows is not an
 * exercise of authority over anything.
 *
 * ## Why there is no user id in the route or the body
 *
 * That absence is the authorization. The row written is `claims.sub` and there is no way to name
 * a different one, so "can this person edit that person's preferences" is a question this API
 * cannot be asked rather than one it has to answer correctly. An id in the body would turn every
 * staff account into an attack surface for a missing ownership check.
 *
 * ## Why it is exempt from the audit log
 *
 * The audit log is the record of decisions with consequences — approvals, role changes, money.
 * A row per person per time they change how many rows they see would bury those in noise, and
 * §9.3 wants the log readable. Nothing here affects what anyone can access.
 */
@Controller('admin/me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** The caller's own preferences, read once per registry render. */
  @Get('preferences')
  @AuditExempt("Reads the caller's own display preferences; changes nothing.")
  async preferences(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.me.preferences(user?.sub);
  }

  /**
   * Remembers a page size for one registry.
   *
   * `204`, not the updated row: the caller already knows what it asked for, and the console's
   * next render reads the value back anyway.
   */
  @Patch('preferences/table-page-size')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt(
    "A display preference on the caller's own account. It grants nothing and reveals nothing, " +
      'and a row per person per resize would bury the decisions §9.3 wants the log to be readable for.',
  )
  async setTablePageSize(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(tablePageSizeSchema)) body: TablePageSizeInput,
  ): Promise<void> {
    await this.me.setTablePageSize(user?.sub, body);
  }
}
