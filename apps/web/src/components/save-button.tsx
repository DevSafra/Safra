'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ButtonToast } from '@/components/button-toast';

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
  signInHref,
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
  /**
   * Where to send somebody who has to sign in first, carrying their way back.
   *
   * Built by the SERVER, never here from the current URL: it is a redirect target, and a redirect
   * target assembled in the browser from whatever path happens to be showing is the shape that
   * turns a control into an open redirect. The page knows its own locale and its own slug — the
   * same reasoning `returnQuery` states for the console's back links.
   */
  readonly signInHref: string;
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

      /*
        401 is not a failure to report — it is a missing account, and «تعذّر الحفظ. حاول مرة أخرى»
        was a lie about it: trying again fails identically, forever, and nothing on the screen said
        an account was needed (Bashar hit exactly this, 2026-09-04).

        The page cannot know in advance. It is cached with `revalidate = 60`, so its HTML is shared
        between readers and carries nobody's session — which is also why `initiallySaved` is absent
        here. So the button asks, and turns the one answer that has a next step into that step.

        `next` brings them back to the listing they were looking at, which is the whole point of
        signing in at that moment.
      */
      if (response.status === 401) {
        setSaved(!next);
        setBusy(false);
        router.push(signInHref);

        return;
      }

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
    <div className="relative w-fit">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={saved}
        className={`inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors duration-200 ease-out-strong sm:min-h-11 ${
          saved
            ? 'border-gold bg-gold/12 text-gold'
            : 'border-text2/30 bg-field text-text hover:border-gold hover:bg-gold/10'
        }`}
      >
        {/*
          The heart is decoration: the label carries the meaning, so it is hidden from readers.

          Hover moves the BORDER and the fill, never the label.

          `--gold` on this button's ground is 3.46:1 — fine for a border, under the 4.5
          floor for a 14px label — so a hover that recoloured the text made it harder to
          read at exactly the moment somebody was reading it. Darkening the gold is the
          other way out and Bashar has rejected that twice: the brand colour is the
          design's.
        */}
        <HeartIcon filled={saved} />
        {saved ? labels.saved : labels.save}
      </button>

      {/*
        The same toast the share button uses, for the same reason: it was a block underneath, so a
        failed save pushed the whole page down and back up. Two implementations of «a short message
        about this control» is how they come to behave differently.
      */}
      <ButtonToast message={failed ? { text: labels.failed, tone: 'bad' } : null} />
    </div>
  );
}

/**
 * The heart, drawn.
 *
 * It was «♡» and «♥» — Unicode, which is the operating system's drawing rather than the product's:
 * it arrives at a different weight and a different baseline on every platform, and beside a stroked
 * share mark on the same row that difference is the first thing the eye finds. One path, filled or
 * stroked, at the same 1.75 stroke as every other icon here.
 *
 * `fill` and `stroke` both animate, so pressing it fills rather than swaps.
 */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 transition-colors duration-200 ease-out-strong"
    >
      <path d="M12 20.4 3.9 12.3a5 5 0 0 1 7.1-7.05L12 6.2l1-.95a5 5 0 0 1 7.1 7.05Z" />
    </svg>
  );
}
