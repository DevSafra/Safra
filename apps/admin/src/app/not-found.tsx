import Link from 'next/link';

import { ORNAMENT_BRAND } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * The console's 404, which was Next's English default until 2026-08-20.
 *
 * ## What it looked like, and why that is worse than it sounds
 *
 * Bashar reported the page as "written on the left, while the current language is Arabic". Both
 * halves were literally true: the content was Next's built-in `404 / This page could not be found.`,
 * and because the root layout correctly sets `dir="rtl"`, the bidi algorithm put the full stop at
 * the START of the sentence. So the one page whose whole job is to tell a staff member what went
 * wrong was in the wrong language AND rendered as though the console were broken.
 *
 * ## A wrong reference is ORDINARY, not exceptional
 *
 * `/partners/PAR-999999` lands here as surely as a typo does — a stale bookmark, a record that was
 * deleted, a reference pasted one digit wrong out of an email. Support agents work from references
 * all day. So this page names the likely causes rather than only the fact, and gives one link back.
 *
 * ## No sidebar, deliberately
 *
 * `ConsoleShell` needs the sidebar counts, which is an authenticated API round trip. Putting a
 * network call on the path that renders when something has already gone wrong buys a nav list and
 * risks a blank page — so this is standalone, the same shape as `/login`, and the way back is a
 * plain link. The hamburger is not available here; the link is.
 *
 * Tailwind and `dir="rtl"` both arrive from the root layout, so unlike the customer app's root
 * `not-found` this one needs no inline styles.
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

        {/*
          `inline-flex min-h-10 items-center` because `min-height` does nothing to an inline element,
          and below `lg` a control a finger has to hit is at least 40px — the rule the responsive
          section states for anchors styled as controls.
        */}
        <Link
          href="/"
          className="border-line bg-card text-gold-ink hover:border-gold mt-8 inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-4 text-sm lg:min-h-0"
        >
          {t.notFound.home}
        </Link>
      </div>
    </main>
  );
}
