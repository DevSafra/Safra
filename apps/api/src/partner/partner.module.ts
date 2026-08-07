import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { CalendarService } from './calendar.service.js';
import { PartnerDashboardService } from './dashboard.service.js';
import {
  AdminPartnerDocumentsController,
  PartnerDocumentsController,
} from './documents.controller.js';
import { PartnerDocumentsService } from './partner-documents.service.js';
import { PartnerImagesController } from './images.controller.js';
import { PartnerController } from './partner.controller.js';
import { PartnerRegistrationService } from './partner-registration.service.js';
import { PropertiesService } from './properties.service.js';
import { PropertyImageService } from './property-images.service.js';

@Module({
  controllers: [
    PartnerController,
    PartnerImagesController,
    PartnerDocumentsController,
    AdminPartnerDocumentsController,
  ],
  providers: [
    PropertiesService,
    PropertyImageService,
    PartnerDashboardService,
    CalendarService,
    PartnerRegistrationService,
    PartnerDocumentsService,
    // Self-registration hashes the applicant's password with the same Argon2id
    // parameters as customer registration — one password policy, one cost.
    PasswordService,
    AuditService,
  ],
  exports: [PropertiesService, CalendarService],
})
export class PartnerModule {}
