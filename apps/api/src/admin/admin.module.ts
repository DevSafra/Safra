import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PartnerTwoFactorService } from '../auth/partner-two-factor.service.js';
import { AdminGrantsController, AdminGrantsService } from './grants.controller.js';
import { AdminController } from './admin.controller.js';
import { CityImagesController } from './city-images.controller.js';
import { AuditLogService } from './audit-log.service.js';
import { DashboardService } from './dashboard.service.js';
import { BookingDetailService } from './booking-detail.service.js';
import { AdminOperationsController } from './operations.controller.js';
import { StaffRolesController } from './staff-roles.controller.js';
import { StaffRolesService } from './staff-roles.service.js';
import { FxModule } from '../fx/fx.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { EnforcementController } from './enforcement.controller.js';
import { EnforcementNotifier } from './enforcement-notifier.js';
import { EnforcementService } from './enforcement.service.js';
import { ReviewService } from './review.service.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';
import { StaffController, StaffInvitationController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsAdminService } from '../settings/settings-admin.service.js';
import { RegistriesController } from './registries.controller.js';
import { BookingListService } from './booking-list.service.js';
import { RegistryService } from './registry.service.js';
import { FinanceService } from './finance.service.js';
import { PromotionsService } from './promotions.service.js';
import { GeoService } from './geo.service.js';
import { ReportsService } from './reports.service.js';
import { StaffOverviewService } from './staff-overview.service.js';
import { EmergencyService } from './emergency.service.js';
import { CommsController } from './comms.controller.js';
import { DisputeService } from './dispute.service.js';
import { MessagingService } from './messaging.service.js';
import { AdvertisingService } from './advertising.service.js';
import { PartnerContractService } from './partner-contract.service.js';
import { BookingExportService } from './booking-export.service.js';
import { ExportRequestService } from './export-request.service.js';
import { StaffScopeService } from './staff-scope.service.js';

@Module({
  // StaffService needs AuthTokenService, MailService, PasswordService and
  // TokenService, all of which AuthModule owns.
  /*
    `LedgerModule` and `FxModule` arrived with enforcement (2026-08-24): waiving a fine posts a
    balancing ledger entry, and posting one needs the currency's rate to SYP. `MailService` is
    already here through `AuthModule`'s exports — the comment at the providers list below says so,
    and importing a second copy would give this module a second nodemailer transport.
  */
  imports: [AuthModule, LedgerModule, FxModule],
  controllers: [
    AdminController,
    RegistriesController,
    CommsController,
    CityImagesController,
    AdminGrantsController,
    AdminOperationsController,
    MeController,
    StaffController,
    StaffInvitationController,
    StaffRolesController,
    EnforcementController,
  ],
  providers: [
    ReviewService,
    StaffRolesService,
    EnforcementNotifier,
    EnforcementService,
    AdminGrantsService,
    AuditLogService,
    DashboardService,
    BookingDetailService,
    SettingsAdminService,
    AuditService,
    PartnerTwoFactorService,
    MeService,
    StaffService,
    // The §8 registry, finance and operations reads — see RegistriesController.
    BookingListService,
    RegistryService,
    FinanceService,
    PromotionsService,
    GeoService,
    ReportsService,
    StaffOverviewService,
    EmergencyService,
    // §8's customer-facing and commercial domains — see CommsController.
    DisputeService,
    MessagingService,
    // A staff reply on a ticket emails the asker. MailService comes from AuthModule's exports.
    NotificationService,
    AdvertisingService,
    PartnerContractService,
    // B-12 staff scope and B-13 the audited export (Bashar, 2026-08-04).
    StaffScopeService,
    BookingExportService,
    ExportRequestService,
  ],
  /*
    `PartnerContractService` is exported because the PARTNER portal writes through it too: the
    partner uploading their counter-signed copy is the second half of the same state machine, and
    a second copy of that machine in `PartnerModule` is how the two halves start disagreeing about
    what `awaiting_partner_signature` means. AdminModule does not import PartnerModule, so there
    is no cycle to create.
  */
  exports: [ReviewService, BookingExportService, PartnerContractService],
})
export class AdminModule {}
