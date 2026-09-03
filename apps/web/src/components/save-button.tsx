'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The save-to-favourites control (handoff §6, المفضلة).
 *
 * ## Optimistic, and honest when it fails
 *
 * The pressed state flips immediately, because a heart that waits for a round trip feels broken. If
 * the request then fails the state flips BACK and the reason is shown — an optimistic control that
 * silently keeps a state the server rejected is worse than a slow one, because the reader believes
 * something that is not true.
 *
 * ## A button, with `aria-pressed`
 *
 * Not a checkbox and not a link: it toggles a state on the server and stays on the page.
 * `aria-pressed` is what tells a screen-reader user whether this listing is currently saved, and the
 * label names the ACTION in both directions rather than reporting the state ambiguously.
 */
export function SaveButton({
  slug,
  initiallySaved,
  labels,
}: {
  readonly slug: string;
  /**
   * The known state, where the caller has one.
   *
   * المفضلة knows — everything on it is saved. The property page cannot: it is cached, so its HTML is
   * shared between readers and must carry nobody's shortlist. Omitting this makes the button ask for
   * itself after mounting, which keeps the page cacheable.
   */
  readonly initiallySaved?: boolean;
  readonly labels: {
    readonly save: string;
    readonly saved: string;
    readonly failed: string;
  };
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved ?? false);

  useEffect(() => {
    /* The caller already knew; nothing to ask. */
    if (initiallySaved !== undefined) return undefined;

    let live = true;

    void fetch(`../api/favourites?slug=${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!live) return;
        if (payload && typeof payload === 'object' && 'saved' in payload) {
          setSaved(Boolean(payload.saved));
        }
      })
      .catch(() => {
        /* Left as "not saved". A failed read must not make the control unusable. */
      });

    return () => {
      live = false;
    };
  }, [slug, initiallySaved]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (busy) return;

    const next = !saved;

    setSaved(next);
    setBusy(true);
    setFailed(false);

    try {
      const response = await fetch('../api/favourites', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });

      if (!response.ok) {
        setSaved(!next);
        setFailed(true);
        setBusy(false);

        return;
      }

      setBusy(false);
      /* So المفضلة is right the moment the reader navigates to it. */
      router.refresh();
    } catch {
      setSaved(!next);
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    /*
      `sm:min-h-11`, and no `lg:min-h-0`. This sits beside «احجز الآن» in the property header
      (Bashar, 2026-09-03) and the pair has to share a top and a bottom edge — released at `lg` it
      collapsed to 38px next to a 44px action, which reads as one of the two having gone wrong. Same
      question the site header answered on 2026-09-02, same answer.
    */
    <div className="grid gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={saved}
        className={`inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm transition-colors sm:min-h-11 ${
          saved
            ? 'border-gold bg-gold/12 text-gold-ink'
            : 'border-line text-muted hover:border-gold hover:text-gold'
        }`}
      >
        {/* The heart is decoration: the label carries the meaning, so it is hidden from readers. */}
        <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
        {saved ? labels.saved : labels.save}
      </button>

      {failed ? (
        <p role="alert" className="text-xs text-bad">
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
