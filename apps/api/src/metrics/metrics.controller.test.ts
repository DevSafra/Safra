import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env.js';
import { MetricsController } from './metrics.controller.js';
import type { MetricsService } from './metrics.service.js';

/**
 * Who may scrape, and what happens to everybody else.
 *
 * The numbers on this endpoint are not secrets, but the endpoint is reconnaissance: it names the
 * subsystems, says which are struggling right now, and shows when the platform is least attended.
 * So the interesting behaviour is not the exposition — it is the four ways of being refused, and
 * that all four look identical from outside.
 */
const TOKEN = 'a'.repeat(32);

function controller(token?: string) {
  /* Held separately so the assertion below reads the spy, not a method off the cast object. */
  const expose = vi.fn(() => Promise.resolve('safra_media_reachable 1\n'));

  const instance = new MetricsController(
    { expose } as unknown as MetricsService,
    {
      ...(token ? { METRICS_TOKEN: token } : {}),
    } as unknown as Env,
  );

  return { instance, expose };
}

describe('MetricsController', () => {
  it('serves the exposition to a scraper with the right token', async () => {
    const { instance } = controller(TOKEN);

    expect(await instance.scrape(`Bearer ${TOKEN}`)).toContain('safra_media_reachable');
  });

  /**
   * 404, not 401, and the same 404 for every refusal.
   *
   * A 401 confirms the route exists and invites guessing. A 404 is indistinguishable from a build
   * that never had the endpoint, which is what somebody probing should conclude.
   */
  it('answers 404 when no token is configured, as if the route did not exist', async () => {
    const { instance, expose } = controller();

    await expect(instance.scrape(`Bearer ${TOKEN}`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    /* And it never reached the database to find that out. */
    expect(expose).not.toHaveBeenCalled();
  });

  it('answers 404 for a wrong token', async () => {
    const { instance } = controller(TOKEN);

    await expect(instance.scrape(`Bearer ${'b'.repeat(32)}`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for no authorization header at all', async () => {
    const { instance } = controller(TOKEN);

    await expect(instance.scrape()).rejects.toBeInstanceOf(NotFoundException);
  });

  /* A token pasted without the scheme is a wrong token, not a partially-accepted one. */
  it('answers 404 when the Bearer scheme is missing', async () => {
    const { instance } = controller(TOKEN);

    await expect(instance.scrape(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * A prefix of the real token must be refused, and refused the same way.
   *
   * This is the case a length check has to catch before `timingSafeEqual`, which throws on unequal
   * lengths rather than returning false — an uncaught throw here would be a 500, and a 500 where a
   * 404 belongs tells an attacker their guess was interesting.
   */
  it('refuses a prefix of the token without throwing something else', async () => {
    const { instance } = controller(TOKEN);

    await expect(instance.scrape(`Bearer ${TOKEN.slice(0, 16)}`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
