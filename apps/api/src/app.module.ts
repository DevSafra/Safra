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
import { PaymentsModule } from './payments/payments.module.js';
import { RankingModule } from './ranking/ranking.module.js';
import { SearchModule } from './search/search.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StorageModule } from './storage/storage.module.js';
import { JwtAuthGuard } from './rbac/jwt-auth.guard.js';
import { PermissionsGuard } from './rbac/permissions.guard.js';

@Module({
  imports: [
    DatabaseModule,
    // Cron support for the nightly ranking recompute. The job itself takes a
    // Postgres advisory lock so only one replica runs it — see RankingScheduler.
    ScheduleModule.forRoot(),
    /**
     * Global default rate limit. Individual routes tighten this with @Throttle —
     * auth endpoints are far stricter. A global floor means a newly added endpoint
     * is protected before anyone remembers to think about it.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    SettingsModule,
    StorageModule,
    LedgerModule,
    FxModule,
    AuthModule,
    BookingsModule,
    SearchModule,
    PartnerModule,
    PaymentsModule,
    RankingModule,
    AdminModule,
    CatalogModule,
  ],
  providers: [
    // Order matters: throttling runs first (cheapest rejection), then
    // authentication, then authorization. Never spend a database round trip on a
    // request that a rate limiter was going to reject anyway.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Runs after the guards, so an unauthorised request is never audited as an
    // action. Also warns about mutating routes with no audit declaration (§15).
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
