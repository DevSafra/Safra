import { afterAll, describe, expect, it } from 'vitest';

import { closeContractBrowser, renderContractPdf } from './contract-pdf.js';
import {
  CONTRACT_PAGE_FOOTER,
  CONTRACT_PAGE_HEADER,
  renderContractHtml,
} from './contract-template.js';

/**
 * A real Chromium, printing the real contract twice (2026-10-07).
 *
 * The template promised that identical terms render to identical bytes, and a returned scan is
 * matched to the hash it was signed against. Chromium stamped the current second into every PDF,
 * so the promise held only for two prints inside the same second. The unit tests prove the stamp is
 * rewritten; only a real print proves the render path actually does it, and that nothing ELSE in
 * Chromium's output varies between two runs.
 */
describe('printing the same contract twice', () => {
  afterAll(() => closeContractBrowser());

  it('produces the same bytes, more than a second apart', async () => {
    const html = renderContractHtml({
      partnerReference: 'PAR-000001',
      partnerLegalName: 'شركة الاختبار',
      partnerDisplayName: 'فندق الاختبار',
      issuedOn: '2026-10-07',
    });
    const chrome = { header: CONTRACT_PAGE_HEADER, footer: CONTRACT_PAGE_FOOTER };

    const first = await renderContractPdf(html, chrome);

    /* Past the next whole second, which is the resolution Chromium stamps at. */
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const second = await renderContractPdf(html, chrome);

    expect(first.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(second.equals(first)).toBe(true);
  }, 60_000);
});
