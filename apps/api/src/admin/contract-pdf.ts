import { chromium, type Browser } from 'playwright-core';

import { CONTRACT_PAGE_FOOTER, CONTRACT_PAGE_HEADER } from './contract-template.js';

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

/** How the browser is started. A parameter so a test can hand in one that fails. */
export type LaunchBrowser = () => Promise<Browser>;

const launchChromium: LaunchBrowser = () => chromium.launch({ args: ['--no-sandbox'] });

/**
 * One reused browser and a bounded number of renders at a time.
 *
 * ## Every path out of a render gives its slot back (2026-10-06)
 *
 * `acquire()` used to run before the `try`, and so did starting the browser and opening the
 * context. A launch that failed, or a context that could not be created, left the slot taken for
 * the life of the process; two such failures and every later render waited for ever behind slots
 * nobody would release. Now the slot is released in a `finally` that wraps EVERYTHING after it is
 * taken, and closing the context cannot throw past it.
 *
 * ## A failed launch is not remembered
 *
 * The launch promise was cached whether it resolved or rejected, so one bad start (a missing
 * Chromium, a full `/tmp`, a container OOM-killed mid-launch) answered every later call with the
 * same rejection without trying again. A rejected launch now clears the cache, so the next render
 * starts a fresh one.
 */
export function createContractRenderer(
  launch: LaunchBrowser = launchChromium,
  maxConcurrent = MAX_CONCURRENT,
) {
  let browserPromise: Promise<Browser> | null = null;
  let active = 0;
  const waiting: (() => void)[] = [];

  async function sharedBrowser(): Promise<Browser> {
    const existing = browserPromise;

    if (existing) {
      const browser = await existing;

      if (browser.isConnected()) return browser;
    }

    const launching = launch();

    browserPromise = launching;

    /* Cleared only if it is still OURS: a later launch must not be forgotten by an earlier failure. */
    launching.catch(() => {
      if (browserPromise === launching) browserPromise = null;
    });

    return launching;
  }

  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
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

  return {
    /**
     * @param html A complete, self-contained document. Built by `renderContractHtml`, never by a
     *   caller — nothing here escapes anything, because everything that needed escaping was
     *   escaped where the values were known.
     */
    async render(html: string): Promise<Buffer> {
      await acquire();

      try {
        const browser = await sharedBrowser();
        /*
          A context with NO permissions, no storage and no network state. This document is inert
          HTML we wrote; the context is minimal so that stays true even if a future template gains
          a script.
        */
        const context = await browser.newContext({
          locale: 'ar',
          javaScriptEnabled: false,
        });

        try {
          const page = await context.newPage();

          await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
          /* The template's `@page` rules are print rules, so print media is what they apply to. */
          await page.emulateMedia({ media: 'print' });

          /*
            The running header and footer the contract itself has (its name at the top, its title
            and «صفحة N» at the foot). `preferCSSPageSize` keeps the template's own `@page` margins,
            which is where Chromium draws them.
          */
          return await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: CONTRACT_PAGE_HEADER,
            footerTemplate: CONTRACT_PAGE_FOOTER,
          });
        } finally {
          await context.close().catch(() => undefined);
        }
      } finally {
        release();
      }
    },

    /** Closes the shared browser. For tests, which must not leave a Chromium process behind. */
    async close(): Promise<void> {
      const existing = browserPromise;

      browserPromise = null;

      if (existing)
        await existing.then((browser) => browser.close()).catch(() => undefined);
    },
  };
}

const shared = createContractRenderer();

export function renderContractPdf(html: string): Promise<Buffer> {
  return shared.render(html);
}

/** Closes the shared browser. For tests, which must not leave a Chromium process behind. */
export function closeContractBrowser(): Promise<void> {
  return shared.close();
}
