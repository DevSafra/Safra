import Link from 'next/link';

import type { Locale } from '@/i18n/routing';
import { HeaderNav } from '@/components/header-nav';
import { MenuLocale } from '@/components/menu-locale';

/**
 * What the phone menu holds: everything the bar gives up below `md`.
 *
 * ## Why it is a component rather than markup inside the header
 *
 * `MobileMenu` is client code — it owns an open/closed boolean — and everything in here is not.
 * The links read the pathname, the account link reads the session. Passing this in as `children`
 * keeps the server-rendered parts server-rendered: the only thing that ships to the browser for
 * the menu is the button and the shell it opens.
 *
 * ## Why it is not the desktop bar's own elements, moved
 *
 * One element cannot be in two places in a layout, and the alternative — rendering the bar once
 * and re-flowing it with CSS — was tried and is what produced a three-row header at 320px. So the
 * controls are declared twice, at two sizes, and the thing that keeps them in step is that both
 * take the SAME components and the same catalogue keys: `HeaderNav` renders the destinations here
 * exactly as it does up there, current-page marking included.
 *
 * The language control is the one thing NOT taken from the bar as-is: the bar's is
 * popup triggers, and a popup opened from inside a popup is two focus traps and an ambiguous
 * Escape. `MenuLocale` renders the same choices as open lists instead, which also answers the
 * question a trigger hides — which language am I reading right now.
 */
export function MenuContents({
  locale,
  links,
  partnerLabel,
  navLabel,
  session,
  accountLabel,
  registerLabel,
  signInLabel,
  accountTitle,
  localeLabels,
}: {
  readonly locale: Locale;
  readonly links: readonly { href: string; label: string }[];
  readonly partnerLabel: string;
  /** Names the list of destinations for a screen reader — the same label the bar's nav carries. */
  readonly navLabel: string;
  readonly session: { user: { email: string } } | null;
  readonly accountLabel: string;
  readonly registerLabel: string;
  readonly signInLabel: string;
  readonly accountTitle?: string | undefined;
  readonly localeLabels: { language: string };
}) {
  return (
    <>
      {/*
        The same component the bar uses, so «you are here» is marked the same way in both and
        cannot drift. `w-full` on its links: in a stacked menu a 13.5px word is a small target
        floating in a wide row, and the whole row should answer the press.
      */}
      <HeaderNav
        links={links}
        label={navLabel}
        className="flex flex-col items-stretch gap-0.5"
        linkClassName="min-h-12 w-full px-3 text-16"
      />

      <Link
        href={`/${locale}/partners/join`}
        /*
        `min-h-12`, not `min-h-11`, and 44 was the bug rather than the target.

        `table-overflow`'s sibling assertion in `responsive.spec.ts` requires every menu row to be
        at least 44px, and these sat at EXACTLY 44 — compliant, and balanced on the threshold, so a
        sub-pixel of layout rounding tipped them under it. It failed about one run in five once the
        Arabic face changed the metrics on 2026-09-10.

        48 is also what the four rows around them already used, so this is one row height in the
        sheet rather than two, which is the reason to prefer it over nudging the assertion.
      */
        className="inline-flex min-h-12 w-full items-center rounded-lg px-3 text-16 font-semibold text-muted transition-colors duration-200 ease-out-strong hover:bg-gold/10 hover:text-text"
      >
        {partnerLabel}
      </Link>

      {/*
        The language, shown OPEN with the current one filled in (Bashar, 2026-09-03: «I do not see
        the current language… inside it»). See `MenuLocale` for why it is a list here and a popup on
        the bar. The currency list beside it went when the platform reduced to one currency.
      */}
      <MenuLocale locale={locale} labels={localeLabels} />

      {/* A rule, because what follows is about the READER rather than about the site. */}
      <div className="mt-2 grid gap-2 border-t border-line pt-4">
        {session ? (
          <Link
            href={`/${locale}/account`}
            className="btn-gold inline-flex min-h-12 items-center justify-center rounded-lg px-4 text-16 font-bold transition-opacity duration-200 ease-out-strong hover:opacity-90"
            title={accountTitle}
          >
            {accountLabel}
          </Link>
        ) : (
          <>
            {/*
              Sign in FIRST here, where the bar puts it last.

              The bar reads left to right along a row and ends on its strongest control; a stacked
              menu is read top to bottom and the first thing under the rule is the one that gets
              pressed. Somebody who already has an account is the commoner case on a return visit,
              which is most visits.
            */}
            <Link
              href={`/${locale}/login`}
              className="btn-gold inline-flex min-h-12 items-center justify-center rounded-lg px-4 text-16 font-bold transition-opacity duration-200 ease-out-strong hover:opacity-90"
            >
              {signInLabel}
            </Link>
            <Link
              href={`/${locale}/register`}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-gold/60 px-4 text-16 font-semibold text-text transition-colors duration-200 ease-out-strong hover:border-gold hover:bg-gold/10"
            >
              {registerLabel}
            </Link>
          </>
        )}
      </div>
    </>
  );
}
