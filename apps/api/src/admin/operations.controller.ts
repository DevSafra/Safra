import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSIONS as P, pageQuerySchema } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { SettingsAdminService } from '../settings/settings-admin.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditLogService } from './audit-log.service.js';
import { BookingDetailService } from './booking-detail.service.js';

const auditQuerySchema = pageQuerySchema.extend({
  /** Prefix, so `partner.` finds every partner action. */
  action: z.string().trim().max(80).optional(),
  subjectType: z.string().trim().max(40).optional(),
  subjectId: z.string().uuid().optional(),
  actorEmail: z.string().trim().max(254).optional(),
});

type AuditQueryInput = z.infer<typeof auditQuerySchema>;

const settingUpdateSchema = z
  .object({
    /**
     * `unknown`, because the valid shape depends on the setting's own declared
     * schema — a rate is a number, a money value may be an object. The service
     * validates against `value_schema`, which is the only place that knows.
     */
    value: z.unknown(),
    /** Why. Optional but recorded, because "who changed the fee" needs a because. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

type SettingUpdateInput = z.infer<typeof settingUpdateSchema>;

/**
 * The operational read-and-configure surface (SRS §9.3, §9.4, §15).
 *
 * Three sections that share nothing but a permission boundary, kept in one
 * controller because splitting them would mean three files of five lines each.
 */
@Controller('admin')
export class AdminOperationsController {
  constructor(
    private readonly audit: AuditLogService,
    private readonly bookings: BookingDetailService,
    private readonly settings: SettingsAdminService,
  ) {}

  /**
   * The audit trail (§15, item 65).
   *
   * `AUDIT_LOG_READ` — finance and super admin. Deliberately not operations or
   * support: the log records what THEY did, and the people whose actions are being
   * recorded should not be the ones reading the record.
   */
  @Get('audit-log')
  @RequirePermissions(P.AUDIT_LOG_READ)
  async auditLog(@Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQueryInput) {
    return this.audit.list(query);
  }

  @Get('audit-log/actions')
  @RequirePermissions(P.AUDIT_LOG_READ)
  async auditActions() {
    return { actions: await this.audit.actions() };
  }

  /**
   * One booking with its full timeline (§9.4).
   *
   * `BOOKING_READ_ALL`, held by support, finance and operations. The payment section
   * is added only for holders of `PAYMENT_READ` — see BookingDetailService.
   */
  @Get('bookings/:reference')
  @RequirePermissions(P.BOOKING_READ_ALL)
  async bookingDetail(
    @Param('reference') reference: string,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.bookings.detail(reference, user);
  }

  /** The Rules Engine (§9.3, P-005). `SETTINGS_READ` for operations and above. */
  @Get('settings')
  @RequirePermissions(P.SETTINGS_READ)
  async listSettings() {
    return { settings: await this.settings.list() };
  }

  @Get('settings/:key/history')
  @RequirePermissions(P.SETTINGS_READ)
  async settingHistory(@Param('key') key: string) {
    return { history: await this.settings.history(key) };
  }

  /**
   * Changes one setting. `SETTINGS_UPDATE` — super admin only.
   *
   * Operations can READ the Rules Engine because they work to it daily; changing a
   * commission or a fine is a different act, and §4 keeps it with the role that owns
   * platform configuration.
   */
  @Put('settings/:key')
  @RequirePermissions(P.SETTINGS_UPDATE)
  @AuditExempt(
    'SettingsAdminService records setting.updated inside the write transaction.',
  )
  async updateSetting(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(settingUpdateSchema)) body: SettingUpdateInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.settings.update(key, body.value, body.reason, {
      userId: user?.sub,
      role: user?.role,
    });
  }
}
