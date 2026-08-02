import { ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import type { Database } from '@safra/db';

import { HealthController } from './health.controller.js';

/**
 * Liveness and readiness (M-6).
 *
 * The properties worth pinning are the ones that make a health check harmful when they
 * are wrong: liveness must not depend on anything external, and Redis must not be able
 * to pull a replica out of rotation.
 */
describe('HealthController', () => {
  const up = () => Promise.resolve(1);
  const down = () => Promise.reject(new Error('connection refused'));
  const hang = () => new Promise(() => undefined);

  function controller(database: () => Promise<unknown>, redis: () => Promise<unknown>) {
    return new HealthController(
      { execute: database } as unknown as Database,
      { ping: redis } as unknown as Redis,
    );
  }

  describe('liveness', () => {
    it('answers without touching a dependency', () => {
      /**
       * Constructed with dependencies that would throw if called. A failed liveness
       * probe KILLS the container, so a liveness check that touches the database
       * restarts every healthy replica during a database blip and turns a recoverable
       * incident into an outage.
       */
      const throwing = () => {
        throw new Error('liveness must not touch this');
      };

      expect(controller(throwing, throwing).live()).toEqual({ status: 'ok' });
    });
  });

  describe('readiness', () => {
    it('is ready when both dependencies answer', async () => {
      await expect(controller(up, up).ready()).resolves.toEqual({
        status: 'ready',
        database: 'up',
        redis: 'up',
      });
    });

    it('is not ready when the database is down', async () => {
      await expect(controller(down, up).ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    /**
     * Redis being down must NOT remove a replica from rotation. Rate limiting fails
     * open by design and everything else still works, so pulling every replica out
     * because the cache is unavailable would be a self-inflicted outage.
     */
    it('stays ready but reports degraded when only Redis is down', async () => {
      await expect(controller(up, down).ready()).resolves.toEqual({
        status: 'ready',
        database: 'up',
        redis: 'degraded',
      });
    });

    it('names the failed dependency in the 503 body', async () => {
      const error = await controller(down, down)
        .ready()
        .catch((e: ServiceUnavailableException) => e);

      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        status: 'not_ready',
        database: 'down',
        redis: 'degraded',
      });
    });

    /**
     * A probe that hangs is worse than one that fails: until the load balancer's own
     * timeout fires the replica is neither in nor out of rotation.
     */
    it('treats a hanging dependency as down rather than hanging', async () => {
      await expect(controller(hang, up).ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    }, 10_000);
  });
});
