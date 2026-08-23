import { chromium, type Browser } from 'playwright-core';

/**
 * A contract HTML document, printed to PDF by a headless browser we run.
 *
 * ## Why a browser, again
 *
 * The same reason the customer app's receipt gives, and it matters more here: `pdfkit` and
 * `pdf-lib` do no contextual glyph shaping and no bidirectional layout, so Arabic renders as
 * disconnected left-to-right letterforms. A receipt that looks wrong is embarrassing; a CONTRACT
 * that looks wrong is unusable, and its Arabic half is the operative one for most partners.
 *
 * ## `setContent`, not `goto`
 *
 * The receipt navigates to a URL because it prints a page the customer can also see. This prints a
 * document that exists nowhere else — it is generated, hashed and stored in one pass — so the HTML
 * is handed straight to the page. Nothing is fetched, which is also what keeps it deterministic:
 * two renders of the same terms produce the same bytes, and the signatures depend on that.
 *
 * ## The limits are the same, and for the same reason
 *
 * One browser process, reused, and at most two renders at a time. Launching Chromium per request
 * turns a console button into a memory-exhaustion tool, and this one is reachable by any staff
 * member holding `PARTNER_APPROVE`.
 *
 * ## Deployment, stated rather than assumed
 *
 * This puts a Chromium dependency in the API image, which the customer app already carries for
 * receipts but the API did not. `M-1` owns the container work and `O-fin-3` records the
 * requirement — an API image without the browser fails this call at runtime, and nothing earlier
 * will say so.
 */
const MAX_CONCURRENT = 2;
const RENDER_TIMEOUT_MS = 20_000;

let browserPromise: Promise<Browser> | null = null;
let active = 0;
const waiting: (() => void)[] = [];

async function sharedBrowser(): Promise<Browser> {
  const existing = browserPromise;

  if (existing) {
    const browser = await existing;

    if (browser.isConnected()) return browser;
  }

  browserPromise = chromium.launch({ args: ['--no-sandbox'] });

  return browserPromise;
}

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;

    return;
  }

  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  waiting.shift()?.();
}

/**
 * @param html A complete, self-contained document. Built by `renderContractHtml`, never by a
 *   caller — nothing here escapes anything, because everything that needed escaping was escaped
 *   where the values were known.
 */
export async function renderContractPdf(html: string): Promise<Buffer> {
  await acquire();

  const browser = await sharedBrowser();
  /*
    A context with NO permissions, no storage and no network state. This document is inert HTML we
    wrote; the context is minimal so that stays true even if a future template gains a script.
  */
  const context = await browser.newContext({ locale: 'ar', javaScriptEnabled: false });

  try {
    const page = await context.newPage();

    await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
    /* The template's `@page` rules are print rules, so print media is what they apply to. */
    await page.emulateMedia({ media: 'print' });

    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await context.close();
    release();
  }
}

/** Closes the shared browser. For tests, which must not leave a Chromium process behind. */
export async function closeContractBrowser(): Promise<void> {
  const existing = browserPromise;

  browserPromise = null;

  if (existing) await (await existing).close().catch(() => undefined);
}
