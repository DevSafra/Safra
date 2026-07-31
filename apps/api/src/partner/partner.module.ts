import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { CalendarService } from './calendar.service.js';
import { PartnerImagesController } from './images.controller.js';
import { PartnerController } from './partner.controller.js';
import { PartnerRegistrationService } from './partner-registration.service.js';
import { PropertiesService } from './properties.service.js';

@Module({
  controllers: [PartnerController, PartnerImagesController],
  providers: [
    PropertiesService,
    CalendarService,
    PartnerRegistrationService,
    // Self-registration hashes the applicant's password with the same Argon2id
    // parameters as customer registration — one password policy, one cost.
    PasswordService,
    AuditService,
  ],
  exports: [PropertiesService, CalendarService],
})
export class PartnerModule {}
