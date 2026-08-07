import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { AuditService } from './common/audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './admin/admin.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { FxModule } from './fx/fx.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { PartnerModule } from './partner/partner.module.js';
import { PayoutModule } from './payouts/payout.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RankingModule } from './ranking/ranking.module.js';
import { ReviewModule } from './reviews/review.module.js';
import { SanctionsModule } from './sanctions/sanctions.module.js';
import { SearchModule } from './search/search.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StorageModule } from './storage/storage.module.js';
import { WalletModule } from './wallet/wallet.module.js';
import { HealthModule } from './health/health.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage.js';
import {
  accountTracker,
  skipUnlessAccountNamed,
} from './common/throttle/account-tracker.js';
import { JwtAuthGuard } from './rbac/jwt-auth.guard.js';
import { PermissionsGuard } from './rbac/permissions.guard.js';
import { TwoFactorGuard } from './rbac/two-factor.guard.js';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    // Cron support for the nightly ranking recompute. The job itself takes a
    // Postgres advisory lock so only one replica runs it — see RankingScheduler.
    ScheduleModule.forRoot(),
    /**
     * Global default rate limit. Individual routes tighten this with @Throttle —
     * auth endpoints are far stricter. A global floor means a newly added endpoint
     * is protected before anyone remembers to think about it.
     *
     * Counters live in Redis, not in the process — see RedisThrottlerStorage. With the
     * default in-memory store the effective limit was N × 120 across N replicas and
     * every counter reset on deploy.
     */
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 120 },
          /**
           * The per-ACCOUNT limit, added 2026-08-07 (Bashar).
           *
           * Applies wherever a request body names an email — login, registration, password reset,
           * email verification — and is keyed on IP + a hash of that address rather than on IP
           * alone. See `account-tracker.ts` for why both, and for what still stops credential
           * stuffing once one NAT user can no longer starve another.
           *
           * Ten a minute per (person, network). The per-IP ceiling on those same routes is what
           * bounds an attacker cycling addresses, and the five-attempt account lockout in
           * `AuthService` is what bounds a distributed one.
           */
          {
            name: 'account',
            ttl: 60_000,
            limit: 10,
            skipIf: skipUnlessAccountNamed,
            getTracker: (req: Record<string, unknown>) =>
              Promise.resolve(accountTracker(req)),
          },
        ],
        storage,
      }),
    }),
    SettingsModule,
    StorageModule,
    LedgerModule,
    FxModule,
    WalletModule,
    AuthModule,
    BookingsModule,
    SearchModule,
    PartnerModule,
    PayoutModule,
    PaymentsModule,
    RankingModule,
    ReviewModule,
    SanctionsModule,
    AdminModule,
    CatalogModule,
    HealthModule,
  ],
  providers: [
    // Order matters: throttling runs first (cheapest rejection), then
    // authentication, then authorization. Never spend a database round trip on a
    // request that a rate limiter was going to reject anyway.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After JwtAuthGuard (it needs request.user) and before PermissionsGuard: an
    // unenrolled staff account is refused on enrolment grounds, not on a permission
    // it may well hold.
    { provide: APP_GUARD, useClass: TwoFactorGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Runs after the guards, so an unauthorised request is never audited as an
    // action. Also warns about mutating routes with no audit declaration (§15).
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
