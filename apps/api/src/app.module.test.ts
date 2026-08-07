import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';
import { envSchema, ENV } from './config/env.js';
import { DATABASE } from './database/database.module.js';
import { REDIS } from './redis/redis.tokens.js';

/**
 * The API boots.
 *
 * This exists because `PayoutModule` shipped without `AuditService` in its providers and every
 * other suite stayed green: unit tests construct a service with `new`, and the integration tests
 * talk to the database directly. Nothing assembled the container, so a dependency Nest could not
 * resolve was invisible until `node dist/main.js` refused to start — after `pnpm verify` had
 * passed, which is precisely the window this repository has no review branch to catch.
 *
 * A missing provider is not a typo class of bug. It is a whole module — its controllers, its
 * routes, its authorization — absent from a running server, and the symptom is the process
 * exiting rather than one endpoint misbehaving.
 *
 * ## Why the three overrides
 *
 * The question here is whether the dependency GRAPH resolves, not whether this machine has a
 * database. Overriding the two connections and the environment keeps the check running everywhere
 * `pnpm test` runs, including a fresh checkout with no `.env`, and leaves every real provider —
 * services, controllers, guards, interceptors — to be constructed for real. Those constructions
 * are what fails when a provider is missing.
 *
 * `compile()` and not `init()`: initialisation starts the cron schedule and opens listeners, which
 * is a different question and one the e2e suite already answers.
 */
describe('AppModule', () => {
  it('resolves every provider in the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(fakeEnv())
      .overrideProvider(DATABASE)
      .useValue({})
      .overrideProvider(REDIS)
      .useValue({})
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});

/**
 * A complete, schema-valid environment.
 *
 * Parsed through `envSchema` rather than hand-written as an object so this fixture cannot drift
 * away from the real shape: adding a required variable fails this test until it is added here,
 * which is the reminder a deployment would otherwise deliver.
 */
function fakeEnv() {
  return envSchema.parse({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    ADMIN_URL: 'http://localhost:3001',
    DATABASE_URL: 'postgres://user:pw@localhost:5432/safra_test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    FIELD_ENCRYPTION_KEY: '0'.repeat(64),
  });
}
