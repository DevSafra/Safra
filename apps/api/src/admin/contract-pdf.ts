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

/**
 * A running header and footer, printed in every page's margin.
 *
 * OPT-IN, and only the partner contract opts in. The voucher prints through this same renderer, and
 * on 2026-10-07 the contract's footer was briefly applied to everything, so every booking voucher
 * would have carried «اتفاقية شراكة تجارية … صفحة N» under the guest's QR code. A document that
 * passes none prints exactly as it did before page chrome existed.
 */
export interface PageChrome {
  readonly header: string;
  readonly footer: string;
}

/** The fixed moment written over Chromium's own, the same length to the byte: see below. */
const FIXED_PDF_MOMENT = '20000101000000';

/**
 * Replaces the creation and modification times Chromium stamps on every PDF with a fixed one.
 *
 * Chromium writes the current second into the document's info dictionary
 * (`/CreationDate (D:20261007150119+00'00')`), so two prints of the same contract a second apart
 * differed and so did their hashes — while the template promised identical bytes for identical
 * terms, and a returned scan is matched to the hash it was signed against (found 2026-10-07).
 *
 * The digits are replaced IN PLACE with a value of exactly the same length, so every byte offset in
 * the file's cross-reference table stays true and the PDF stays valid. `latin1` maps each byte to
 * one character and back, so nothing else in the binary stream is touched.
 */
export function withFixedTimestamps(pdf: Buffer): Buffer {
  const text = pdf.toString('latin1');
  const fixed = text.replace(
    /(\/(?:CreationDate|ModDate) \(D:)\d{14}/g,
    (_, key: string) => `${key}${FIXED_PDF_MOMENT}`,
  );

  return fixed === text ? pdf : Buffer.from(fixed, 'latin1');
}

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
    async render(html: string, chrome?: PageChrome): Promise<Buffer> {
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
            Page chrome only when the caller asks for it. With it, `preferCSSPageSize` keeps the
            document's own `@page` margins, which is where Chromium draws the header and footer;
            without it, the options are the ones every document had before chrome existed.
          */
          const bytes = await page.pdf({
            format: 'A4',
            printBackground: true,
            ...(chrome
              ? {
                  preferCSSPageSize: true,
                  displayHeaderFooter: true,
                  headerTemplate: chrome.header,
                  footerTemplate: chrome.footer,
                }
              : {}),
          });

          return withFixedTimestamps(bytes);
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

export function renderContractPdf(html: string, chrome?: PageChrome): Promise<Buffer> {
  return shared.render(html, chrome);
}

/** Closes the shared browser. For tests, which must not leave a Chromium process behind. */
export function closeContractBrowser(): Promise<void> {
  return shared.close();
}
