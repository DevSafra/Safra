import { timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ENV, type Env } from '../config/env.js';
import { Public } from '../rbac/decorators.js';
import { MetricsService } from './metrics.service.js';

/**
 * `GET /internal/metrics` — the scrape target alerting reads (`docs/alerting.md`).
 *
 * ## Why it is not simply public
 *
 * The numbers here are not secrets in themselves — nobody is harmed by knowing how many
 * notifications failed in the last hour. But a metrics endpoint is a **reconnaissance surface**:
 * it tells a stranger which subsystems exist, which ones are struggling right now, and when the
 * platform is least attended. Publishing that is a courtesy to somebody choosing a moment.
 *
 * ## Off unless configured, and it 404s rather than 401s
 *
 * With no `METRICS_TOKEN` the route answers 404, exactly as if it did not exist. Fail closed, and
 * quietly: a 401 confirms the endpoint is there and invites guessing, while a 404 is
 * indistinguishable from a version that never had it.
 *
 * The same 404 answers a wrong token, for the same reason.
 *
 * ## The comparison is timing-safe
 *
 * `===` on a secret leaks its prefix to anybody who can measure a few thousand requests, which is
 * anybody. `timingSafeEqual` needs equal lengths, so the length check comes first and is itself a
 * (small, unavoidable) disclosure — the token is 32 bytes of random and its length is not the part
 * worth protecting.
 *
 * ## Not behind the RBAC guard
 *
 * A scraper has no user, no session and no role, so `@Public()` is correct — the token IS the
 * authentication. Putting it behind a permission would mean minting a service account, which is a
 * larger surface than one bearer token for one read-only route.
 */
@Controller('internal')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get('metrics')
  /* Scrapes are frequent by design, and several replicas share one proxy address. */
  @Throttle({ default: { limit: 1_000, ttl: 60_000 } })
  @AuditExempt('A scrape is not a business event, and it changes nothing.')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  /* Never cached by a proxy: a stale scrape is a lie about the present moment. */
  @Header('Cache-Control', 'no-store')
  async scrape(@Headers('authorization') authorization?: string): Promise<string> {
    const expected = this.env.METRICS_TOKEN;

    if (!expected) throw new NotFoundException();

    const offered = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    if (!matches(offered, expected)) throw new NotFoundException();

    return this.metrics.expose();
  }
}

/** Constant-time comparison, once the lengths are known to match. */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
