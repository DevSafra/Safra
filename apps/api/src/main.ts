import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { API_PREFIX } from './config/constants.js';
import { JsonLogger } from './common/logging/json.logger.js';
import { requestIdMiddleware } from './common/logging/request-id.middleware.js';
import { loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Validate configuration BEFORE Nest starts, so a misconfigured deploy fails
  // immediately and visibly rather than serving broken requests.
  const env = loadEnv();

  /**
   * Structured JSON in every environment but development, at the level LOG_LEVEL
   * asks for. That variable was declared in the schema and read by nothing, so the
   * setting appeared to work and did not.
   */
  const logger = new JsonLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    /**
     * Keeps the unparsed request body available as `req.rawBody`.
     *
     * Mandatory for payment webhooks: the signature is computed over the exact bytes
     * the provider sent, and `JSON.parse` followed by `JSON.stringify` reorders keys
     * and normalises whitespace, so a digest taken from the parsed object never
     * matches. Without this the usual "fix" is to stop verifying signatures.
     */
    rawBody: true,
  });

  /**
   * Required for correct client IPs behind Cloudflare and the load balancer.
   * Set to 1 — the number of proxies we actually terminate through. `true` would
   * accept any X-Forwarded-For a client sends, letting an attacker forge their IP
   * and walk straight through the rate limiter.
   */
  app.set('trust proxy', 1);

  /**
   * FIRST, before anything that might log. Everything downstream runs inside the
   * request context this establishes, so a line written by a later middleware —
   * including a helmet or CORS rejection — still carries the correlation ID.
   */
  app.use(requestIdMiddleware);

  app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === 'production' }));
  app.use(cookieParser());

  app.enableCors({
    // Explicit allow-list. A wildcard with credentials is rejected by browsers
    // anyway, and would be an open door if it were not (rule 1).
    origin: [env.APP_URL, env.ADMIN_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  /**
   * No global ValidationPipe. Validation is done per route with
   * ZodValidationPipe against the schemas in @safra/contracts, which the web apps
   * reuse verbatim. Nest's ValidationPipe would need class-validator and a parallel
   * set of DTO classes — a second source of truth for every field, and the two
   * would drift.
   *
   * Unknown-field rejection is not lost: every request schema is .strict().
   */
  app.setGlobalPrefix(API_PREFIX);
  /**
   * SIGTERM closes the app rather than killing it, so in-flight requests finish and
   * the Redis and database pools drain. A rolling deploy otherwise severs whatever
   * was mid-request at the moment the old replica was replaced.
   */
  app.enableShutdownHooks();

  /**
   * Logged so shutdown is OBSERVABLE. A container that exits fast looks identical
   * whether it drained cleanly or was killed outright, and the difference only shows
   * up later as unexplained truncated requests during deploys.
   */
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      new Logger('Bootstrap').log(`${signal} received; draining and shutting down.`);
    });
  }

  await app.listen(env.PORT);

  new Logger('Bootstrap').log(
    `SAFRA API listening on http://localhost:${env.PORT}/${API_PREFIX} ` +
      `[${env.NODE_ENV}, log level ${env.LOG_LEVEL}]`,
  );
}

void bootstrap();
