'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * The heart on a result card — `SaveButton`'s behaviour in booking.com's shape.
 *
 * The state is KNOWN on arrival: the server asked which of this batch the reader saved in one query
 * (`savedSlugs`), so a page of twenty cards costs no request per card. A signed-out reader gets an
 * empty heart, and pressing it takes them to sign in and back — the 401 answer `SaveButton`
 * documents, rather than a failure message that trying again would repeat for ever.
 *
 * Optimistic: the heart changes on the press and goes back if the server refuses, with the failure
 * said aloud for a screen reader.
 */
export function SaveHeart({
  slug,
  initiallySaved,
  signInHref,
  labels,
}: {
  readonly slug: string;
  readonly initiallySaved: boolean;
  /** Built by the SERVER — a redirect target is never assembled in the browser from the URL. */
  readonly signInHref: string;
  readonly labels: {
    readonly save: string;
    readonly saved: string;
    readonly failed: string;
  };
}) {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (busy) return;

    const next = !saved;

    setSaved(next);
    setBusy(true);
    setFailed(false);

    try {
      const response = await fetch(`/${params.locale}/api/favourites`, {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });

      if (response.status === 401) {
        setSaved(!next);
        router.push(signInHref);
        return;
      }

      if (!response.ok) {
        setSaved(!next);
        setFailed(true);
      }
    } catch {
      setSaved(!next);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={saved}
        aria-label={saved ? labels.saved : labels.save}
        className="grid size-10 cursor-pointer place-items-center rounded-full bg-card/90 text-text shadow-[var(--shadow-lift)] backdrop-blur-sm transition-[transform,color] duration-150 ease-out hover:text-crimson focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.92] motion-reduce:transition-none"
      >
        <svg
          aria-hidden
          width="1.15em"
          height="1.15em"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-[fill,color] duration-200 ease-out ${saved ? 'fill-crimson text-crimson' : 'fill-transparent'}`}
        >
          <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.5 1.1 4.6 2.7C13.1 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4Z" />
        </svg>
      </button>
      <span role="status" className="sr-only">
        {failed ? labels.failed : ''}
      </span>
    </>
  );
}
