'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';
import { reloadInto } from '@/lib/session-navigation';

/**
 * Sign out.
 *
 * A POST, not a link. A GET that destroys a session can be triggered by any image
 * tag or prefetch pointing at it — and browsers and link scanners follow those
 * eagerly, so a GET logout signs people out at random. The route handler also
 * revokes the refresh family at the API, so this ends the session everywhere rather
 * than only in this browser.
 */
export function SignOutButton({ locale }: { locale: Locale }) {
  const t = useTranslations('auth');
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);

    try {
      await fetch(`/${locale}/api/auth/logout`, { method: 'POST' });
    } catch {
      /**
       * Ignored deliberately. The handler clears the cookie regardless of what the
       * API said, so navigating on is what actually completes the sign-out from this
       * browser's point of view. Blocking on a network error would leave the
       * customer stuck on a page that still looks signed in.
       */
    }

    /*
      A full document load. `router.refresh()` + `push()` left the home page wearing the SIGNED-IN
      header — «حسابي» after signing out — because the refresh applies to the page being left and the
      push renders a cached copy of the destination. See `reloadInto`.
    */
    reloadInto(`/${locale}`);
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      /*
        `w-full`, so it fills the row it is given (Bashar, 2026-08-12).

        Its only home is the foot of the account sidebar, beside the 40px theme toggle, and shrink-to-fit
        left it floating in the middle of a stretched wrapper — the partner portal's sign-out has taken
        the rest of its row since that shell was built.

        `cursor-pointer` because Tailwind's reset leaves `<button>` with the default arrow, and the
        project rule is that anything clickable feels clickable. Height comes from `globals.css`, which
        gives every `button` a 40px floor below `lg`.
      */
      className="w-full cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-gold/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? t('signingOut') : t('signOut')}
    </button>
  );
}
