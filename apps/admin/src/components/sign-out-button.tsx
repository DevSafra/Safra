'use client';

import { useState } from 'react';
import { reloadInto } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * Sign out.
 *
 * A POST, not a link: a GET that destroys a session is triggered by any prefetch or
 * link scanner that happens across it, which signs people out at random. The handler
 * also revokes the refresh family at the API, so this ends the session everywhere
 * rather than only in this browser — which is the point on a shared machine.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignored: the handler clears the cookie regardless, so navigating on is what
      // completes the sign-out from this browser's point of view.
    }

    /*
      A full document load — see `reloadInto`. `refresh()` refetches the page being LEFT, which is a
      guarded route the middleware answers with `/login?next=<here>`, while `push` renders a cached
      copy of the destination. The console's chrome is server-rendered from the session cookie, so
      the two together left it wearing a signed-in sidebar after signing out.
    */
    reloadInto('/login');
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      /*
        `flex-1` and centred, so it fills the sidebar's width beside the 40px theme toggle — the
        shape لوحة الشريك already had, and what Bashar asked the console to match (2026-08-14).

        It was `inline-flex` with no grow, so it hugged its two words and left a ragged gap to the
        end of the column: the one control at the foot of a full-width nav, not reaching either
        edge of it. The button is the only place this lives, so the sizing is here rather than in
        a wrapper — there is no second caller to surprise.
      */
      className="flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-gold/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? t.dashboard.signingOut : t.dashboard.signOut}
    </button>
  );
}
