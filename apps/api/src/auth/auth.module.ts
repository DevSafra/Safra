import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { MailService } from '../mail/mail.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { TokenService } from './token.service.js';
import { TwoFactorController } from './two-factor.controller.js';
import { TwoFactorService } from './two-factor.service.js';

@Module({
  // Claiming a guest profile carries its wallet balance across, so a customer who
  // was compensated as a guest does not lose it on registering.
  imports: [WalletModule],
  controllers: [AuthController, TwoFactorController],
  providers: [
    AuthService,
    TokenService,
    AuthTokenService,
    AccountRecoveryService,
    TwoFactorService,
    PasswordService,
    FieldEncryptionService,
    MailService,
    AuditService,
  ],
  // TokenService is exported because JwtAuthGuard is registered globally and
  // resolves it from the root injector.
  exports: [TokenService, AuditService, PasswordService, FieldEncryptionService],
})
export class AuthModule {}
