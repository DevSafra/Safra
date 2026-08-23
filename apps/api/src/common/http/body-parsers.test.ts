import { Body, Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureBodyParsers } from './body-parsers.js';

/**
 * The two JSON body limits, and the trap between them (Bashar, 2026-08-21).
 *
 * ## Why this test exists at all
 *
 * Mounting a path-scoped `express.json()` makes Nest skip registering its OWN parser, because
 * `ExpressAdapter.registerParserMiddleware` looks for a router-stack handler named `jsonParser` and
 * `express.json()` returns a function with exactly that name. The consequence is not a crash: every
 * other endpoint in the platform quietly decides its request has no body, so a sign-in answers
 * «expected object, received undefined» and it reads as a validation bug in whatever you were
 * testing.
 *
 * That shipped for about ten minutes and was caught by hand. Nothing in the unit or integration
 * suites could have seen it, because it lives in the bootstrap rather than in a service — hence a
 * real Nest app, on a real port, with real requests.
 *
 * ## What it deliberately does not use
 *
 * Not `AppModule`: that needs a database, Redis and object storage to boot, and none of them are
 * involved in the question. A two-route module wired by the SAME function is the whole subject.
 */
@Controller()
class EchoController {
  /** Stands in for every ordinary route — the ones the regression silently broke. */
  @Post('anything')
  ordinary(@Body() body: unknown): { received: boolean } {
    return { received: typeof body === 'object' && body !== null };
  }

  /** Mounted under a path the large limit is scoped to. */
  @Post('api/v1/admin/partner-contracts/echo')
  file(@Body() body: unknown): { received: boolean } {
    return { received: typeof body === 'object' && body !== null };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe('the JSON body parsers', () => {
  let app: NestExpressApplication;
  let origin = '';

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(EchoModule, {
      logger: false,
      rawBody: true,
    });

    configureBodyParsers(app);

    /* Port 0: the OS picks a free one, so this never collides with a running dev server. */
    await app.listen(0);
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, bytes: number) =>
    fetch(`${origin}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filler: 'x'.repeat(bytes) }),
    });

  /**
   * THE test. This is the one that would have caught the regression, and it asserts the least
   * interesting-sounding thing in the file: that an ordinary route still receives its body.
   */
  it('still parses an ordinary body on an unscoped route', async () => {
    const response = await post('anything', 100);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it('keeps the small limit on an unscoped route', async () => {
    /* Comfortably over 100kb, comfortably under the file limit. */
    expect((await post('anything', 300_000)).status).toBe(413);
  });

  it('allows a large body on a scoped route', async () => {
    const response = await post('api/v1/admin/partner-contracts/echo', 600_000);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  /**
   * And the scoped limit is a limit, not an absence of one. 15mb is the envelope; a file over
   * `MAX_BYTES` is refused by the route's own schema well before this.
   */
  it('still has a ceiling on a scoped route', async () => {
    expect(
      (await post('api/v1/admin/partner-contracts/echo', 16 * 1024 * 1024)).status,
    ).toBe(413);
  });
});
