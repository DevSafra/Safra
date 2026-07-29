import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { DatabaseModule } from './database/database.module.js';
import { SearchModule } from './search/search.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { JwtAuthGuard } from './rbac/jwt-auth.guard.js';
import { PermissionsGuard } from './rbac/permissions.guard.js';

@Module({
  imports: [
    DatabaseModule,
    /**
     * Global default rate limit. Individual routes tighten this with @Throttle —
     * auth endpoints are far stricter. A global floor means a newly added endpoint
     * is protected before anyone remembers to think about it.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    SettingsModule,
    AuthModule,
    BookingsModule,
    SearchModule,
  ],
  providers: [
    // Order matters: throttling runs first (cheapest rejection), then
    // authentication, then authorization. Never spend a database round trip on a
    // request that a rate limiter was going to reject anyway.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
