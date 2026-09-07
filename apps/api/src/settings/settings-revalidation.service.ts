import { Inject, Injectable, Logger } from '@nestjs/common';

import { OPERATING_SETTINGS_TAG } from '@safra/contracts';

import { describeError } from '../common/errors/safe-error.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.js';

/**
 * Tells the front ends that a setting changed, so a save is visible at once.
 *
 * Bashar, 2026-09-08: *"I would like configuration changes to become visible immediately after a
 * settings update… the platform should reflect those updates without requiring users to wait
 * several minutes for caches to expire."*
 *
 * Deriving a figure from configuration is half the promise; the other half is that a change
 * arrives. الرئيسية is prerendered with `revalidate = 300` and العقار with 60, and the console's
 * settings read held sixty seconds of its own — so an operator who changed the fee watched two
 * screens quote the old one and had no way to tell a slow cache from a failed save.
 *
 * ## The partner portal is NOT called, and that is not an omission
 *
 * `partnerFetch` is `cache: 'no-store'`, stated there as something callers may not change, and the
 * dashboard is `force-dynamic`. It re-reads the API on every request, and the API's own settings
 * cache is invalidated in the same breath as the write. A route in that app would be a capability
 * with nothing behind it — the shape this review has found repeatedly and should not add.
 *
 * ## Every write, not only the operational keys
 *
 * A list of "keys worth purging" is one somebody has to remember to extend, and the failure is
 * silent: a new setting reads stale for five minutes and nothing says so. Two HTTP calls on an
 * action an admin takes a few times a month is not worth a list that decays.
 *
 * ## Best effort, always
 *
 * A front end that is restarting must never fail a settings write that has already committed. Each
 * call is bounded, failures are logged with the app that could not be reached, and nothing is
 * retried — the TTL on the other side is the floor that makes a missed call cost freshness rather
 * than correctness.
 */
@Injectable()
export class SettingsRevalidationService {
  private readonly logger = new Logger(SettingsRevalidationService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Asks each front end to drop its cached view of the settings.
   *
   * Awaited by the caller so a test can observe it, and safe to await in a request: the timeout
   * bounds the whole fan-out, and the settings write has already committed by the time this runs.
   */
  async revalidate(key: string): Promise<void> {
    const secret = this.env.REVALIDATE_SECRET;

    if (!secret) {
      /*
        Warned once per change rather than left silent. An unconfigured secret is a DEPLOYMENT
        state, not a code fault — the platform still works and still corrects itself within the
        TTL — but «the fee I saved is not showing» is a support ticket nobody can diagnose from
        the outside, and this line is where it gets answered.
      */
      this.logger.warn(
        `REVALIDATE_SECRET is not set, so the front ends keep their cached settings until their ` +
          `own TTL expires. "${key}" was saved and is in force; only its display lags.`,
      );

      return;
    }

    const targets: readonly { name: string; url: string }[] = [
      { name: 'customer', url: this.env.APP_URL },
      { name: 'console', url: this.env.ADMIN_URL },
    ];

    await Promise.all(
      targets.map(async ({ name, url }) => {
        try {
          const response = await fetch(`${url}/api/revalidate-settings`, {
            method: 'POST',
            headers: { 'x-safra-revalidate': secret },
            signal: AbortSignal.timeout(3_000),
          });

          if (!response.ok) {
            /*
              A 404 here is the front end's fail-closed answer to a wrong or missing secret, and it
              is worth naming: the two sides disagreeing about the secret is otherwise indis-
              tinguishable from a front end that is simply down.
            */
            this.logger.warn(
              `The ${name} app refused to revalidate after "${key}" changed ` +
                `(HTTP ${response.status}). It will pick the change up when its cache expires.`,
            );
          }
        } catch (error) {
          /*
            `describeError`, never `error.message`: a raw message can carry a connection string or
            a hostname, and this line goes to a log a lot of people read. The sweep beside it holds
            the rule for the whole API and caught this within the minute of it being written.
          */
          this.logger.warn(
            `Could not reach the ${name} app to revalidate after "${key}" changed: ` +
              `${describeError(error)}. Its cache expires on its own.`,
          );
        }
      }),
    );

    this.logger.log(
      `Asked the front ends to drop "${OPERATING_SETTINGS_TAG}" after "${key}".`,
    );
  }
}
