import { Controller, Get, Param, Query } from '@nestjs/common';

import { type CursorQuery, cursorQuerySchema } from '@safra/contracts';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { BookingsService } from './bookings.service.js';

/**
 * Read-only booking access.
 *
 * Deliberately NOT decorated with @RequirePermissions. Both customers
 * (booking.read_own) and staff (booking.read_all) reach these routes, and
 * PermissionsGuard requires ALL listed permissions — so a flat gate would either
 * exclude one group or have to be loosened to "any", which is the weaker
 * guarantee.
 *
 * Instead the service resolves an AccessScope, which decides BOTH whether the
 * caller may read at all and which rows they may see. One mechanism, one place,
 * and it cannot be satisfied without also being scoped.
 *
 * JwtAuthGuard still applies globally — there is no @Public() here, so anonymous
 * requests never arrive.
 */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    return this.bookings.list(user, query);
  }

  /** Lookup by human reference (BKG-2026-000001), as used in support and vouchers. */
  @Get(':reference')
  async findOne(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.bookings.findByReference(user, reference);
  }
}
