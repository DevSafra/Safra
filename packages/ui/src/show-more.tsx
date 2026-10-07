'use client';

import { useRouter } from 'next/navigation.js';
import { useTransition, type MouseEvent } from 'react';

/**
 * «عرض المزيد» at the end of a list: the next fifteen rows appear beneath the ones on screen
 * (Bashar, 2026-10-07). Built once, here, and used by every app's cursor lists.
 *
 * ## A link first, a button second
 *
 * It renders an ordinary `<a href>` to the list's next state (`showMoreQuery` in
 * `@safra/contracts`), so it works before hydration, opens in a new tab on a modified click, and is
 * a plain navigation to anything that is not a person with a mouse. A plain left click is taken
 * over and made a SOFT navigation with `scroll: false`: the server renders the longer list, React
 * keeps every row already on screen and adds the new ones under them, and the page does not move.
 * `replace`, not `push`, so «back» leaves the list rather than stepping through its lengths.
 *
 * ## Loading says so, without moving
 *
 * The two labels share one grid cell and the inactive one is `invisible`, so the control is as wide
 * as the longer of the two in both states and the row beneath it never shifts. `aria-busy` tells
 * assistive technology what the spinner tells the eye; the spinner stops for anyone who has asked
 * for reduced motion, and the words still change.
 *
 * Every word is the caller's — required, never defaulted — for the reason `PasswordField` gives.
 */
export function ShowMore({
  href,
  label,
  loadingLabel,
}: {
  readonly href: string;
  readonly label: string;
  readonly loadingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    /* A modified or middle click keeps the browser's own meaning: a new tab, a new window. */
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();

    /* A second press while the first is loading would only queue the same request again. */
    if (pending) return;

    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  return (
    <a
      href={href}
      onClick={onClick}
      aria-busy={pending}
      className="group mt-4 flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-line bg-card px-5 text-sm font-semibold text-text transition-[border-color,color,transform] duration-150 ease-out hover:border-gold/60 hover:text-gold-read focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:scale-[0.98] aria-busy:cursor-progress aria-busy:text-muted"
    >
      <span className="grid items-center">
        <span
          className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-2 ${pending ? 'invisible' : ''}`}
        >
          {label}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 transition-transform duration-150 ease-out group-hover:translate-y-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
        <span
          className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-2 ${pending ? '' : 'invisible'}`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 animate-spin motion-reduce:animate-none"
            fill="none"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="2"
            />
            <path
              d="M14 8a6 6 0 0 0-6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          {loadingLabel}
        </span>
      </span>
    </a>
  );
}
