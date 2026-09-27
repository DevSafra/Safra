import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

/**
 * Checking, at boot, that the browser the partnership agreement is printed in actually exists.
 *
 * ## The failure this exists to catch — `O-ops-1`
 *
 * `PartnerContractService.generate` renders the agreement by printing HTML in headless Chromium.
 * The customer app has carried that dependency since receipts; **the API had not, and now does** —
 * and `apps/api/Dockerfile` is `node:22.12-alpine` with `tini` and nothing else. An image built
 * from it starts, answers every route, passes its health check, and fails this one call at run
 * time.
 *
 * The register's own words: «nothing earlier says so — the service starts, every other route
 * works, and the first symptom is a staff member pressing «إنشاء العقد» and getting a failure».
 * That is the whole defect being closed here. Whether the browser belongs in the image, or
 * generation moves to a service that already has one, is a deployment decision that belongs with
 * `M-1`; this only makes the answer visible before somebody meets it on a screen.
 *
 * ## Why it warns rather than refusing to boot
 *
 * The same reasoning `MediaReachabilityService` records, and §7b's sixth accepted deviation:
 * contract generation is not on the critical path for booking or payment, and an API that refused
 * to start because a PDF renderer was missing would turn one staff action into an outage. So it is
 * a loud startup error and a flag a deployment can gate on, not a crash.
 *
 * ## Why it checks the PATH rather than launching
 *
 * Launching a browser at every boot costs seconds and memory on every replica, for a question that
 * is answered by a file existing. `executablePath()` is what `chromium.launch()` will use, so this
 * asks the same question the failing call asks, without paying for it.
 *
 * It never throws: a check that can take the API down is a worse failure than the one it reports.
 */
@Injectable()
export class ContractRendererService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContractRendererService.name);

  /** Set once at boot and read by the readiness probe. `unknown` until the check has run. */
  private state: 'ok' | 'missing' | 'unknown' = 'unknown';

  async onApplicationBootstrap(): Promise<void> {
    this.state = await this.probe();

    if (this.state === 'ok') return;

    this.logger.error(
      'No headless browser is installed, so «إنشاء العقد» will fail at the moment a staff member ' +
        'presses it — the partnership agreement is printed in Chromium because pdfkit and pdf-lib ' +
        'do no Arabic shaping. Install playwright-core’s Chromium in the image, or move generation ' +
        'to a service that already has one. See O-ops-1.',
    );
  }

  /** What the readiness probe reports. Never throws. */
  status(): 'ok' | 'missing' | 'unknown' {
    return this.state;
  }

  private async probe(): Promise<'ok' | 'missing'> {
    try {
      const path = chromium.executablePath();

      if (!path) return 'missing';

      await access(path);

      return 'ok';
    } catch {
      /*
        `executablePath()` THROWS when the browser was never downloaded, rather than answering a
        path that does not exist — so the catch is the ordinary «not installed» answer here, not an
        unexpected error. `access` failing lands in the same place, which is correct: a path that
        names nothing is the same fact as no path at all.
      */
      return 'missing';
    }
  }
}
