import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { parseEuSanctionsXml } from './eu-list.parser.js';
import { EU_SOURCE, SanctionsService } from './sanctions.service.js';

/** Distinct advisory-lock key per job; see RankingScheduler for the rationale. */
const SANCTIONS_LOCK_KEY = 8_421_003;

/** A hung download must not hold the lock or the connection indefinitely. */
const FETCH_TIMEOUT_MS = 60_000;

/**
 * Keeping the sanctions list current (ADR 0002).
 *
 * Daily, because the list changes rarely but the STALENESS refusal is measured in
 * days — refreshing weekly would leave the platform one missed run away from being
 * unable to verify anybody.
 *
 * ## The URL is configuration, not a constant
 *
 * `SANCTIONS_FEED_URL` is an environment variable with no default. The EU's
 * consolidated-list download sits behind a token that its publisher issues and
 * occasionally rotates, and hardcoding one would produce a system that silently
 * stops refreshing when it expires — with the staleness refusal firing days later
 * and nobody knowing why. Making it configuration means an operator sets it once and
 * the failure, when it comes, names the variable.
 *
 * Absent the variable, the job logs loudly at startup and does nothing. That is the
 * honest state: screening then depends on a manual import, and the admin screen says
 * so rather than implying an automated check is running.
 */
@Injectable()
export class SanctionsRefreshService {
  private readonly logger = new Logger(SanctionsRefreshService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly sanctions: SanctionsService,
  ) {
    if (!env.SANCTIONS_FEED_URL) {
      this.logger.warn(
        'SANCTIONS_FEED_URL is not set, so the sanctions list will never refresh ' +
          'automatically. Partner verification will refuse once the current list ' +
          'goes stale. Set it to the EU consolidated-list export, or import a list ' +
          'manually via POST /admin/sanctions/import.',
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'sanctions-refresh' })
  async refresh(): Promise<void> {
    if (!this.env.SANCTIONS_FEED_URL) return;

    const acquired = await this.db.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(${SANCTIONS_LOCK_KEY}) AS locked`,
    );

    // Another replica is refreshing. Skipping is correct — the work is not lost.
    if (acquired.rows[0]?.locked !== true) return;

    try {
      const result = await this.fetchAndImport(this.env.SANCTIONS_FEED_URL);

      this.logger.log(
        result.unchanged
          ? `Sanctions list unchanged (${result.entryCount} entries).`
          : `Sanctions list refreshed: ${result.entryCount} entries.`,
      );
    } catch (error) {
      /**
       * Never throws out of a scheduled job — an unhandled rejection kills the
       * process. A failed refresh is not silent, though: the list ages, and once it
       * passes the staleness limit verification refuses outright. The failure
       * surfaces as a blocked queue rather than as a check that quietly stopped
       * happening.
       */
      this.logger.error(
        `Sanctions refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.db.execute(sql`SELECT pg_advisory_unlock(${SANCTIONS_LOCK_KEY})`);
    }
  }

  /** Fetches, parses and imports. Exposed so an admin can trigger it on demand. */
  async fetchAndImport(
    url: string,
  ): Promise<{ entryCount: number; unchanged: boolean; snapshotId: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let body: string;

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`Feed responded ${response.status}.`);
      }

      body = await response.text();
    } finally {
      clearTimeout(timeout);
    }

    /**
     * A suspiciously small body is rejected before parsing.
     *
     * The consolidated list is megabytes; a few kilobytes means an error page, a
     * login redirect, or an expired token — all of which would otherwise parse to
     * zero entries and, without this, import as an empty list that clears everyone.
     */
    if (body.length < 10_000) {
      throw new Error(
        `Feed returned ${body.length} bytes, which is too small to be the ` +
          `consolidated list. Refusing to import it.`,
      );
    }

    const parsed = parseEuSanctionsXml(body);

    return this.sanctions.importSnapshot({
      source: EU_SOURCE,
      rawBody: body,
      publishedAt: parsed.publishedAt,
      entries: parsed.entries,
    });
  }
}
