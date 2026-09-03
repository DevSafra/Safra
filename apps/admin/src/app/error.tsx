'use client';

import Link from 'next/link';

import { ORNAMENT_BRAND } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * The console's error boundary, added 2026-08-20 alongside its 404.
 *
 * ## Same defect class as the missing `not-found`
 *
 * Without this, an unhandled error in a Server Component renders Next's built-in error page:
 * English, unstyled, and under `dir="rtl"` with its punctuation on the wrong side — the exact
 * thing Bashar reported for the 404 ("written on the left, while the current language is Arabic").
 * A staff member seeing it cannot tell a transient API blip from a broken console.
 *
 * ## What it deliberately does NOT show
 *
 * The error. `error.message` on a server error is whatever threw — a query, a URL, a bound
 * parameter — and rule 1 is that errors reaching a client are generic with the detail in the
 * server log. `digest` is Next's own correlation id and is the one thing worth printing, because it
 * is what makes a report matchable to a log line without carrying any of its content.
 *
 * `reset()` re-renders the segment, which is the right first move for the transient case and costs
 * nothing when it is not.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="mx-auto grid min-h-screen max-w-md place-content-center px-4">
      <div className="w-full text-center">
        <p className="text-gold text-3xl" aria-hidden>
          {ORNAMENT_BRAND}
        </p>

        <h1 className="text-text mt-3 text-2xl font-semibold">{t.errorPage.title}</h1>

        <p className="text-muted mt-2 text-sm leading-relaxed">{t.errorPage.body}</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="border-line bg-card text-gold-ink hover:border-gold inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-4 text-sm lg:min-h-0"
          >
            {t.errorPage.retry}
          </button>

          <Link
            href="/"
            className="text-muted hover:text-text inline-flex min-h-10 items-center text-sm lg:min-h-0"
          >
            {t.errorPage.home}
          </Link>
        </div>

        {/*
          The correlation id, and nothing else about the error.

          `digest` is a hash Next also writes to the server log, so a staff member can quote it and
          somebody can find the stack — without the response carrying a query, a parameter or a path.
        */}
        {error.digest ? (
          <p className="text-faint mt-6 font-mono text-[11px]">{error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
