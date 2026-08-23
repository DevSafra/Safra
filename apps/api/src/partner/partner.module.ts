import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { CalendarService } from './calendar.service.js';
import { PartnerDashboardService } from './dashboard.service.js';
import {
  AdminPartnerDocumentsController,
  PartnerDocumentsController,
} from './documents.controller.js';
import { PartnerDocumentsService } from './partner-documents.service.js';
import { PartnerImagesController } from './images.controller.js';
import { PartnerController } from './partner.controller.js';
import {
  AdminPartnerApplicationController,
  PartnerApplicationController,
  PartnerInvitationController,
} from './partner-application.controller.js';
import { PartnerApplicationService } from './partner-application.service.js';
import { PartnerInvitationService } from './partner-invitation.service.js';
import {
  PartnerEmployeeInvitationController,
  PartnerEmployeesController,
} from './partner-employees.controller.js';
import { PartnerEmployeeRolesController } from './partner-employee-roles.controller.js';
import { PartnerEmployeeRolesService } from './partner-employee-roles.service.js';
import { PartnerEmployeesService } from './partner-employees.service.js';
import { AdminPartnerOnboardingController } from './partner-onboarding.controller.js';
import { PartnerOnboardingService } from './partner-onboarding.service.js';
import {
  PartnerContractReadService,
  PartnerContractsController,
} from './partner-contracts.controller.js';
import { PropertiesService } from './properties.service.js';
import { PropertyImageService } from './property-images.service.js';

@Module({
  /*
    `AuthModule` owns the invitation plumbing «انضم كشريك» hands an account over with:
    `AuthTokenService` issues and redeems the single-use link, `TokenService` revokes the sessions
    a converted account already had, `MailService` sends it, `PasswordService` hashes the first
    password. Imported rather than re-provided, so there is one Argon2id cost and one token table.
  */
  imports: [AuthModule, AdminModule],
  controllers: [
    PartnerController,
    PartnerImagesController,
    PartnerDocumentsController,
    AdminPartnerDocumentsController,
    PartnerApplicationController,
    AdminPartnerApplicationController,
    PartnerInvitationController,
    PartnerContractsController,
    AdminPartnerOnboardingController,
    PartnerEmployeesController,
    PartnerEmployeeInvitationController,
    PartnerEmployeeRolesController,
  ],
  providers: [
    PropertiesService,
    PropertyImageService,
    PartnerDashboardService,
    CalendarService,
    PartnerApplicationService,
    PartnerContractReadService,
    PartnerDocumentsService,
    /*
      One invitation path, shared. Both routes to a partner account — accepting a request and
      onboarding somebody in person — issue the same link with the same lifetime, and two copies
      of that would drift without ever failing a test.
    */
    PartnerInvitationService,
    PartnerOnboardingService,
    PartnerEmployeesService,
    PartnerEmployeeRolesService,
  ],
  exports: [PropertiesService, CalendarService, PartnerApplicationService],
})
export class PartnerModule {}
