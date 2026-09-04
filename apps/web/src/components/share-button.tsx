'use client';

import { useState } from 'react';

import { ButtonToast, type ToastMessage } from '@/components/button-toast';

/**
 * «مشاركة» — hand this listing to somebody else.
 *
 * Bashar, 2026-09-04: it replaces «احجز الآن» in the property header. That pairing was always odd
 * — the header's booking link was an anchor to a panel three screens down, and the panel carries
 * the real action with the dates and the price beside it. Sharing and saving are the two things a
 * reader does to a listing rather than with it, so the two of them belong together up here, which
 * is also where booking.com keeps its own pair.
 *
 * ## The Web Share API first, the clipboard second
 *
 * `navigator.share` opens the operating system's own sheet — WhatsApp, Messages, AirDrop — which on
 * a phone is what somebody actually wants and is a list this product could never assemble itself.
 * It exists on mobile Safari and Chrome and mostly does not on a desktop, so the fallback is not an
 * edge case: it is what most desktop readers will get. They get the link on the clipboard and a
 * line saying so.
 *
 * Both paths are feature-DETECTED rather than sniffed, and both are guarded: `navigator.share`
 * rejects when the reader dismisses the sheet, which is not an error and must not be reported as
 * one, and `clipboard.writeText` throws outright on an insecure origin.
 *
 * ## Why the URL is read at click time
 *
 * `window.location.href`, not a prop. The page is cached (`revalidate = 60`), so a URL baked into
 * its HTML would be whatever the first reader's happened to be — and a link is the one thing here
 * that must be exactly the page somebody is looking at, query string included.
 */
export function ShareButton({
  labels,
}: {
  readonly labels: { share: string; copied: string; failed: string };
}) {
  /*
    A NEW object each time, deliberately. `ButtonToast` keys its animation off the identity of this
    prop, so copying twice in a row has to look like two confirmations rather than one that never
    left — and two equal strings would be the same message to a comparison by value.
  */
  const [message, setMessage] = useState<ToastMessage | null>(null);

  async function share() {
    const url = window.location.href;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: document.title, url });

        /*
          No confirmation on this path. The operating system has already shown its own sheet and
          said what happened; a second message underneath it would be the product talking over the
          platform.
        */
        return;
      } catch {
        /* Dismissed, or unavailable after all. Fall through to the clipboard. */
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setMessage({ text: labels.copied, tone: 'ok' });
    } catch {
      setMessage({ text: labels.failed, tone: 'bad' });
    }
  }

  return (
    /* `relative`, because the toast hangs above this box rather than displacing anything. */
    <div className="relative w-fit">
      {/*
        Hover moves the BORDER and the fill, never the label.

        `--gold` on this button's ground is 3.46:1 — fine for a border, under the 4.5
        floor for a 14px label — so a hover that recoloured the text made it harder to
        read at exactly the moment somebody was reading it. Darkening the gold is the
        other way out and Bashar has rejected that twice: the brand colour is the
        design's.
      */}
      <button
        type="button"
        onClick={() => void share()}
        className="inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border border-text2/30 bg-field px-4 text-sm font-semibold text-text transition-colors duration-200 ease-out-strong hover:border-gold hover:bg-gold/10 sm:min-h-11"
      >
        <ShareIcon />
        {labels.share}
      </button>

      <ButtonToast message={message} />
    </div>
  );
}

/**
 * Three nodes and two links — the share mark, drawn.
 *
 * Authored rather than taken from a glyph, for the reason the craft floor gives and the flags
 * already follow: a Unicode symbol is the operating system's drawing, not the product's, and it
 * arrives at a different weight on every platform. `currentColor` so it inherits the button's hover.
 */
function ShareIcon() {
  return (
    <svg
      aria-hidden
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      {/* Stopping short of the circles, so the lines meet their edges rather than their centres. */}
      <path d="M8.6 10.7 15.4 6.3" />
      <path d="M8.6 13.3 15.4 17.7" />
    </svg>
  );
}
