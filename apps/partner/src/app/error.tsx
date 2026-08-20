'use client';

import Link from 'next/link';

import { ORNAMENT_BRAND } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * The portal's error boundary — see the console's for the reasoning; it is the same defect class as
 * its missing `not-found`, fixed in the same change.
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
            className="border-line bg-card text-gold hover:border-gold inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-4 text-sm lg:min-h-0"
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
