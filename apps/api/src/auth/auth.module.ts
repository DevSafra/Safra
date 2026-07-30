import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { TwoFactorController } from './two-factor.controller.js';
import { TwoFactorService } from './two-factor.service.js';

@Module({
  controllers: [AuthController, TwoFactorController],
  providers: [
    AuthService,
    TokenService,
    TwoFactorService,
    PasswordService,
    FieldEncryptionService,
    AuditService,
  ],
  // TokenService is exported because JwtAuthGuard is registered globally and
  // resolves it from the root injector.
  exports: [TokenService, AuditService, PasswordService, FieldEncryptionService],
})
export class AuthModule {}
