import 'server-only';

import { chromium, type Browser } from 'playwright-core';

/**
 * The receipt as a real PDF file, rendered by a headless browser we run.
 *
 * ## Why a browser and not a PDF library
 *
 * `pdfkit` and `pdf-lib` do no contextual glyph shaping and no bidirectional layout, so Arabic comes
 * out as disconnected left-to-right letterforms — perfect to anyone testing in English, unusable for
 * the primary audience. Correct Arabic in a PDF needs a real text engine. `docs/FUTURE-WORK.md`
 * O-fin-2 records this and the alternatives.
 *
 * ## It renders OUR page, not a second copy of the receipt
 *
 * The browser navigates to the receipt URL and prints it. The tempting alternative — building a
 * standalone HTML document for the PDF — is two renderings of one legal-ish document, and they
 * drift: a fee line added to the page would silently be missing from the file somebody keeps.
 *
 * The URL is built from a LITERAL origin and a shape-checked reference. Nothing a caller sends
 * reaches it, so this cannot be pointed at another host.
 *
 * ## The costs, stated
 *
 * Rendering takes on the order of a second, which is over the p95 < 200 ms budget rule 2 sets. It is
 * a user-initiated file download rather than a page render, and O-fin-2's production answer is a
 * queue plus object storage — that lands with the deployment work (M-1). Until then this is
 * synchronous, and it is bounded by the two guards below rather than left open:
 *
 * - ONE browser process, reused. Launching Chromium per request is how a signed-in customer turns a
 *   download button into a memory exhaustion tool.
 * - At most `MAX_CONCURRENT` renders at a time; the rest wait. Unbounded parallel page loads are the
 *   same problem wearing a different hat.
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
 * context. A launch that failed, or a context that could not be created, kept its slot for the
 * life of the process; two such failures and every later download waited for ever. The slot is now
 * released in a `finally` around everything after it is taken, and closing the context cannot
 * throw past it.
 *
 * ## A failed launch is not remembered
 *
 * The launch promise was cached whether it resolved or rejected, so one bad start answered every
 * later download with the same rejection and never tried again. A rejected launch now clears the
 * cache. The API's contract renderer had the same two faults and the same fix.
 */
export function createReceiptRenderer(
  launch: LaunchBrowser = launchChromium,
  maxConcurrent = MAX_CONCURRENT,
) {
  let browserPromise: Promise<Browser> | null = null;
  let active = 0;
  const waiting: (() => void)[] = [];

  async function sharedBrowser(): Promise<Browser> {
    /* Reused across requests, and re-launched if it ever dies. */
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
     * @param url An absolute URL on this site, built by the caller from a literal origin.
     * @param cookie The reader's own session, forwarded so the page renders as they see it.
     */
    async render(url: string, cookie: { name: string; value: string }): Promise<Buffer> {
      await acquire();

      try {
        const browser = await sharedBrowser();
        const context = await browser.newContext({ locale: 'ar' });

        try {
          const { hostname, protocol } = new URL(url);

          await context.addCookies([
            {
              name: cookie.name,
              value: cookie.value,
              domain: hostname,
              path: '/',
              secure: protocol === 'https:',
            },
          ]);

          const page = await context.newPage();

          await page.goto(url, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS });
          /* The same stylesheet the print dialog used, so the file and the paper agree. */
          await page.emulateMedia({ media: 'print' });

          return await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
          });
        } finally {
          await context.close().catch(() => undefined);
        }
      } finally {
        release();
      }
    },
  };
}

const shared = createReceiptRenderer();

/**
 * @param url An absolute URL on this site, built by the caller from a literal origin.
 * @param cookie The reader's own session, forwarded so the page renders as they see it.
 */
export function renderReceiptPdf(
  url: string,
  cookie: { name: string; value: string },
): Promise<Buffer> {
  return shared.render(url, cookie);
}
