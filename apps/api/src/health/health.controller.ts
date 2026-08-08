import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Database } from '@safra/db';

import { MediaReachabilityService } from '../storage/media-reachability.service.js';
import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { DATABASE } from '../database/database.module.js';
import { Public } from '../rbac/decorators.js';
import { REDIS } from '../redis/redis.tokens.js';

/** A dependency check that cannot hang a probe. */
const CHECK_TIMEOUT_MS = 2_000;

/**
 * Liveness and readiness (M-6).
 *
 * Until now `GET /health` returned 404, so no load balancer could tell a wedged
 * replica from a healthy one — it would keep routing traffic to a process that had
 * stopped working, and a rolling deploy had no signal to wait on.
 *
 * ## Why these are two endpoints and not one
 *
 * They answer different questions and a load balancer does different things with the
 * answers.
 *
 * - **Liveness** — "is this process broken beyond recovery?" Checks nothing external.
 *   A failed liveness probe gets the container KILLED, so a probe that touches the
 *   database will, during a database blip, restart every healthy replica
 *   simultaneously and turn a recoverable incident into an outage. This is the single
 *   most common way health checks make things worse, so liveness here is deliberately
 *   trivial: if the event loop can answer, the process is alive.
 *
 * - **Readiness** — "should this replica receive traffic right now?" Checks the
 *   database and Redis. A failure removes the replica from rotation but does NOT kill
 *   it, so it rejoins automatically when its dependencies recover.
 *
 * ## Redis is degraded, not fatal
 *
 * Redis being down does not make a replica unready. Rate limiting fails open by
 * design, and everything else still works — pulling every replica out of rotation
 * because the cache is unavailable would be a self-inflicted outage. It is reported so
 * monitoring can alert, which is the point.
 *
 * Public and unauthenticated: a probe cannot hold a credential. Nothing here reveals
 * anything an attacker does not already know from the service responding at all —
 * no versions, no hostnames, no dependency addresses.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly media: MediaReachabilityService,
  ) {}

  /**
   * Liveness. Never touches a dependency — see the class note.
   *
   * Throttling is relaxed rather than removed: probes are frequent by nature and the
   * default 120/min would trip with several replicas probing through one proxy IP.
   */
  @Public()
  @Get()
  @Throttle({ default: { limit: 1_000, ttl: 60_000 } })
  @AuditExempt('A liveness probe is not a business event.')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness. 200 when this replica can serve, 503 when it cannot.
   *
   * The 503 body names which dependency failed, because the alternative is an
   * operator bisecting a deploy to discover what a load balancer already knew.
   */
  @Public()
  @Get('ready')
  @Throttle({ default: { limit: 1_000, ttl: 60_000 } })
  @AuditExempt('A readiness probe is not a business event.')
  async ready(): Promise<{
    status: 'ready';
    database: 'up';
    redis: 'up' | 'degraded';
    media: string;
  }> {
    const [database, redis] = await Promise.all([
      this.check(() => this.db.execute(sql`SELECT 1`)),
      this.check(() => this.redis.ping()),
    ]);

    /**
     * Only the database decides readiness. Losing it means this replica cannot serve
     * a single request; losing Redis means it serves them with rate limiting degraded.
     */
    if (!database) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        database: 'down',
        redis: redis ? 'up' : 'degraded',
        media: this.media.status(),
      });
    }

    /*
      Media is REPORTED, not decisive.

      An unreadable bucket means every photograph is broken, which is serious and is not a reason to
      take a replica out of rotation — bookings and payments do not touch it. A deployment that
      wants to gate on it reads this field, or sets `MEDIA_REQUIRE_PUBLIC` and never gets here.
    */
    return {
      status: 'ready',
      database: 'up',
      redis: redis ? 'up' : 'degraded',
      media: this.media.status(),
    };
  }

  /**
   * Runs a check with a hard timeout.
   *
   * A probe that hangs is worse than one that fails: the load balancer's own timeout
   * eventually fires, but in the meantime the replica is neither in nor out of
   * rotation. Bounding it here makes the answer always arrive.
   */
  private async check(probe: () => Promise<unknown>): Promise<boolean> {
    try {
      await Promise.race([
        probe(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS),
        ),
      ]);

      return true;
    } catch {
      return false;
    }
  }
}
