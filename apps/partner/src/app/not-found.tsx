import Link from 'next/link';

import { ORNAMENT_BRAND } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * The partner portal's 404, which was Next's English default until 2026-08-20.
 *
 * ## Why it was invisible until somebody was signed in
 *
 * Signed OUT, an unknown path is caught by the middleware and redirected to `/login`, so it looks
 * fine. Signed IN, the middleware lets it through and Next's built-in `404 / This page could not be
 * found.` renders inside the RTL document — English, and with the full stop at the start of the
 * sentence. So the only people who ever saw it were partners, and only after signing in.
 *
 * ## What a partner is usually doing when they land here
 *
 * Following a link to a listing that has been archived, or a payout reference out of an old email.
 * Neither is a mistake worth scolding anyone for, so the copy names the likely cause and points at
 * the dashboard.
 *
 * Standalone rather than inside the portal shell, for the same reason as the console's: the shell
 * fetches, and a page that renders after something has gone wrong should not depend on a round trip.
 * Direction and Tailwind arrive from the root layout.
 */
export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-screen max-w-md place-content-center px-4">
      <div className="w-full text-center">
        <p className="text-gold text-3xl" aria-hidden>
          {ORNAMENT_BRAND}
        </p>

        <h1 className="text-text mt-3 text-2xl font-semibold">{t.notFound.title}</h1>

        <p className="text-muted mt-2 text-sm leading-relaxed">{t.notFound.body}</p>

        <Link
          href="/"
          className="border-line bg-card text-gold hover:border-gold mt-8 inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-4 text-sm lg:min-h-0"
        >
          {t.notFound.home}
        </Link>
      </div>
    </main>
  );
}
