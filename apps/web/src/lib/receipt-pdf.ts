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
 * @param url An absolute URL on this site, built by the caller from a literal origin.
 * @param cookie The reader's own session, forwarded so the page renders as they see it.
 */
export async function renderReceiptPdf(
  url: string,
  cookie: { name: string; value: string },
): Promise<Buffer> {
  await acquire();

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
    await context.close();
    release();
  }
}
