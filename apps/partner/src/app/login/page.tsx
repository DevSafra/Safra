import { safeRedirect } from '@safra/session';
import { ORNAMENT_BRAND } from '@safra/ui';

import { PartnerLoginForm } from '@/components/partner-login-form';
import { t } from '@/lib/strings';

/**
 * Partner sign-in.
 *
 * ## Built like the console's, deliberately
 *
 * Bashar, 2026-08-13. The two sign-in screens are the same object seen twice — one brand mark, one
 * heading, one card, one form — and they had drifted into two different shapes: the console's was a
 * server page around a client form, and this was a single client page with the form loose on the
 * background and no brand mark at all. Matching them is not tidiness for its own sake. These are the
 * two screens a person lands on when something has gone wrong, and a sign-in page that does not look
 * like the product it belongs to is indistinguishable from a phishing page.
 *
 * What that gets, beyond looking right: the heading, the subtitle and the ornament stop being
 * client-side JavaScript. Only the interactive part hydrates now.
 *
 * ## `next` is validated here, not trusted
 *
 * `safeRedirect` is the same guard the console and the public app use. A sign-in form is the single
 * best place to exploit an open redirect, because the page around it is genuinely SAFRA's — so the
 * destination is validated on the SERVER and handed to the form as a plain path.
 *
 * It was previously dropped altogether: middleware set `?next=`, and the form always went to `/`.
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  /* No locale segment in this app, so the fallback is the dashboard root. */
  const next = safeRedirect(query['next'], '');

  return (
    <main className="mx-auto grid min-h-screen max-w-sm place-content-center px-4">
      <div className="w-full">
        {/* `aria-hidden`: an ornament is a glyph, and a screen reader announcing it says nothing. */}
        <p className="text-3xl text-gold" aria-hidden>
          {ORNAMENT_BRAND}
        </p>

        {/*
          Amiri, which the console does not use, and kept on purpose: the partner portal sets the
          display face on its headings throughout, and the sign-in page is not the place to be the one
          screen that does not.
        */}
        <h1 className="mt-3 font-[family-name:var(--font-amiri)] text-2xl font-bold text-gold">
          {t.login.title}
        </h1>
        <p className="mt-1 text-sm text-muted">{t.login.subtitle}</p>

        <div className="mt-8 rounded-xl border border-line bg-card p-6">
          <PartnerLoginForm next={next === '/' ? '/' : next} />
        </div>
      </div>
    </main>
  );
}
