import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { API_PREFIX } from './config/constants.js';
import { loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Validate configuration BEFORE Nest starts, so a misconfigured deploy fails
  // immediately and visibly rather than serving broken requests.
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  /**
   * Required for correct client IPs behind Cloudflare and the load balancer.
   * Set to 1 — the number of proxies we actually terminate through. `true` would
   * accept any X-Forwarded-For a client sends, letting an attacker forge their IP
   * and walk straight through the rate limiter.
   */
  app.set('trust proxy', 1);

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
  app.enableShutdownHooks();

  await app.listen(env.PORT);

  new Logger('Bootstrap').log(
    `SAFRA API listening on http://localhost:${env.PORT}/${API_PREFIX} [${env.NODE_ENV}]`,
  );
}

void bootstrap();
