import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ContractRendererService } from './contract-renderer.service.js';

/**
 * `O-ops-1` — the API image needs a headless browser, and nothing said so until it was pressed.
 *
 * `PartnerContractService.generate` prints the partnership agreement in headless Chromium, because
 * `pdfkit` and `pdf-lib` do no contextual glyph shaping and no bidirectional layout — Arabic comes
 * out as disconnected left-to-right letterforms, and the Arabic half of the contract is the
 * operative one for most partners.
 *
 * `apps/api/Dockerfile` is `node:22.12-alpine` plus `tini`. An image built from it **starts,
 * answers every route, and passes its own health check**, and the first thing that says otherwise
 * is a staff member pressing «إنشاء العقد». That is the defect this closes: not the missing
 * browser, which is a deployment decision belonging with `M-1`, but the silence around it.
 *
 * ## The Dockerfile assertion is the one that will fail
 *
 * The service check answers about THIS machine, where a developer has Chromium. The image is where
 * it is missing, so the durable assertion reads the Dockerfile — and it is written to fail the day
 * somebody adds the browser, because at that point the warning is wrong and this test is how they
 * are told to delete it.
 */
describe('the contract renderer check', () => {
  it('reports a state rather than throwing', async () => {
    const service = new ContractRendererService();

    /* Before the check runs, «unknown» — never «ok». An unasked question is not a pass. */
    expect(service.status()).toBe('unknown');

    await service.onApplicationBootstrap();

    expect(['ok', 'missing']).toContain(service.status());
  });

  /**
   * It never takes the API down, whatever it finds.
   *
   * A boot check that can crash the process is a worse failure than the one it reports — the
   * reasoning §7b's sixth accepted deviation records for the media check, and the same trade here:
   * contract generation is one staff action and is not on the booking or payment path.
   */
  it('never throws at boot', async () => {
    await expect(
      new ContractRendererService().onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  /**
   * THE assertion. The image still has no browser, so the warning is still true.
   *
   * Written as an equality on the fact rather than a `skip`, so that adding Chromium to the image
   * turns this red and whoever did it is told, here, that `O-ops-1` is closed and the startup
   * warning can go. An exemption that quietly stays true is the failure the register warns about;
   * this one is loud in both directions.
   */
  it('still describes an image with no browser in it', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'apps/api/Dockerfile'), 'utf8');

    const hasBrowser = /chromium|playwright install|CHROME|google-chrome/i.test(
      dockerfile,
    );

    expect(
      hasBrowser,
      'the API image now ships a browser — O-ops-1 is closed, so delete this test and the startup warning with it',
    ).toBe(false);
  });
});
