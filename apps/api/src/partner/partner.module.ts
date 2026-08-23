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
      One invitation path, shared. Accepting a request is the only route to a partner account
      today; a second one is coming, and two copies of "how long is an invitation valid" would
      drift without ever failing a test.
    */
    PartnerInvitationService,
  ],
  exports: [PropertiesService, CalendarService, PartnerApplicationService],
})
export class PartnerModule {}
