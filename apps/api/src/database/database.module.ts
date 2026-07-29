import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';

import { createDatabase } from '@safra/db';

import { ENV, type Env, loadEnv } from '../config/env.js';

export const DATABASE = Symbol('DATABASE');

/**
 * Global so every module can inject the database without re-importing this one,
 * and so there is exactly ONE connection pool per process. A pool per module would
 * multiply PostgreSQL backends by the number of modules — the fastest way to
 * exhaust connection slots under load.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => loadEnv(),
    },
    {
      provide: DATABASE,
      inject: [ENV],
      useFactory: (env: Env) => createDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX),
    },
  ],
  exports: [ENV, DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // Drizzle holds the pg Pool; Nest tears the provider down with the container.
    // Explicit hook kept so draining logic has an obvious home when deploys need
    // to finish in-flight requests before exiting.
  }
}
