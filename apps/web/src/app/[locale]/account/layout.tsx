import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import { getCustomerProfileId } from '@/lib/session-server';
import { isLocale } from '@/i18n/routing';

/**
 * حسابي — and what it says to somebody it is not for.
 *
 * ## The sentence this replaces
 *
 * `O-web-1`. An account with no `customer_profiles` row is refused by the API precisely —
 * `customer.profile_missing`, a 403 — and every one of the sixteen account pages turned that into
 * «تعذّر التحميل». True, and useless: it describes a fault where there is none, so the reader tries
 * again, and again. Before 2026-08-21 it was worse — a 403 read as «انتهت الجلسة، سجّل الدخول
 * مجدداً», which is a LOOP, because signing in again mints the same token and earns the same 403.
 *
 * There are ~3,000 partner accounts, the customer site refuses staff but NOT partners, and none of
 * them has a customer profile. Bashar met this on his own account.
 *
 * ## Why a layout, rather than a page state in sixteen files
 *
 * The register's reason for leaving it open was that the useful sentence «needs a page state which
 * SIXTEEN account pages do not have». They do not need one. Every account route is nested under
 * this segment, so one layout answers for all of them, and not one of the sixteen changes — which
 * is what made the small fix of 2026-08-21 the right call at the time and makes this one safe now.
 *
 * ## It costs no request
 *
 * `customerProfileId` is a CLAIM on the access token the API itself issued, and
 * `!claims.customerProfileId` is the exact condition behind `CUSTOMER_PROFILE_MISSING` — so reading
 * the cookie answers the same question the 403 does, without asking. This is NOT authorization: the
 * API re-derives it from the same token on every request and refuses on its own. It only decides
 * which sentence a person reads, so a tampered cookie buys nothing but a different paragraph.
 */
export default async function AccountLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  /*
    Not a guard: `requireAccount` on each page still does `notFound()` for a bad locale and
    redirects a signed-out reader. This only needs a locale good enough to translate with, and
    anything else falls through to the page that will refuse it properly.
  */
  if (!isLocale(locale)) return children;

  setRequestLocale(locale);

  /*
    A signed-OUT reader passes straight through. Their answer is the sign-in redirect every page
    already performs — telling them «this is not a customer account» would name a fault in an
    account they have not yet claimed to hold.
  */
  const profileId = await getCustomerProfileId();

  if (profileId) return children;

  const t = await getTranslations('account');

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <section className="rounded-card border border-line bg-card p-6">
        <h1 className="font-display text-xl font-bold text-text">
          {t('notCustomerTitle')}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{t('notCustomerBody')}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/*
            An anchor styled as a control needs the touch floor spelled out: `min-height` does
            nothing to an inline element, so `inline-flex min-h-10 … lg:min-h-0` is what puts a
            finger-sized target under it below `lg`.
          */}
          <Link
            href={`/${locale}`}
            className="inline-flex min-h-10 items-center rounded-lg border border-gold px-4 py-2 text-sm font-bold text-gold-read transition-colors hover:bg-gold/10 lg:min-h-0"
          >
            {t('notCustomerBrowse')}
          </Link>

          {/* Sign out is the action that actually leads somewhere: back in as a customer. */}
          <div className="w-full sm:w-auto">
            <SignOutButton locale={locale} />
          </div>
        </div>
      </section>
    </div>
  );
}
