import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { SignInRefundInterceptor } from '../common/throttle/sign-in-refund.interceptor.js';
import { MailService } from '../mail/mail.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { CustomerAccountService } from './customer-account.service.js';
import { LoginCodeService } from './login-code.service.js';
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
    CustomerAccountService,
    TwoFactorService,
    LoginCodeService,
    PasswordService,
    FieldEncryptionService,
    MailService,
    AuditService,
    /*
      Route-scoped rather than global (`O-sec-3`). It only makes sense where "did this succeed" is a
      question about a CREDENTIAL, and applying it everywhere would quietly refund the per-IP hit of
      every successful request in the API — which is the throttler switched off, not softened.

      Its dependency resolves from the global RedisModule, so AuthModule imports nothing new.
    */
    SignInRefundInterceptor,
  ],
  // TokenService is exported because JwtAuthGuard is registered globally and
  // resolves it from the root injector. AuthTokenService and MailService are
  // exported for StaffService (M-5), which issues invitation tokens and emails
  // them — importing them rather than re-providing keeps ONE nodemailer transport
  // and one token-issuing path, so a change to either cannot apply in one place
  // and not the other.
  exports: [
    TokenService,
    AuditService,
    PasswordService,
    FieldEncryptionService,
    AuthTokenService,
    MailService,
  ],
})
export class AuthModule {}
