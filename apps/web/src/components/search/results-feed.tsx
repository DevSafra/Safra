'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { CardModel } from '@/lib/search-cards';

import { ResultCard } from './result-card';
import { FAVOURITE_EVENT, type FavouriteChange } from './save-heart';

type Status = 'idle' | 'loading' | 'error' | 'done';

/** How long a remembered list may be restored on the way back from a property. */
const RESTORE_WITHIN_MS = 30 * 60 * 1000;

/**
 * The results, loading as the reader scrolls — no pages (Bashar, 2026-10-01).
 *
 * The first batch is server-rendered, so the page is useful before any script runs and a crawler
 * following `follow` reads real cards. From there a sentinel below the last card asks for the next
 * batch while it is still ~800px away, so on an ordinary scroll the reader never meets the end of a
 * batch at all.
 *
 * ## Coming back to the same place
 *
 * Opening a stay and pressing back must return the reader to the row they opened — the rule the
 * console states for every list a person can click into. An infinite list loses that by default:
 * the batches loaded by scrolling live in this component, and a fresh mount has only the first.
 * So a press on a card records what is loaded and where the window was, keyed by THIS search, and
 * the next mount of the same search restores it once and forgets it. Thirty minutes, because
 * availability moves and an afternoon-old list is a list of rooms that may be gone.
 *
 * `sessionStorage` rather than the account: it is a property of this tab's history, not of the
 * person, and it is lost exactly when the tab is.
 */
export function ResultsFeed({
  initialCards,
  initialNextCursor,
  initialTruncated,
  query,
  locale,
  signInHref,
  labels,
}: {
  initialCards: CardModel[];
  initialNextCursor: string | null;
  initialTruncated: boolean;
  /** The parsed, allow-listed query string the SERVER wrote — never `location.search`. */
  query: string;
  locale: string;
  signInHref: string;
  labels: {
    loading: string;
    end: string;
    loadFailed: string;
    retry: string;
  };
}) {
  /*
    The one line that needs the COUNT this component holds, so it is translated here from the
    catalogue the client already has. A formatter passed from the server would be a function across
    the server/client boundary, which React refuses at request time and no build catches.
  */
  const t = useTranslations('search.results');
  const truncatedLabel = (count: number) => t('endTruncated', { count });
  const [cards, setCards] = useState(initialCards);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [status, setStatus] = useState<Status>(initialNextCursor ? 'idle' : 'done');
  const [truncated, setTruncated] = useState(initialTruncated);
  const [restoredCount, setRestoredCount] = useState(initialCards.length);
  /* The card the reader opened, marked for a moment on the way back so they can see which it was. */
  const [returnedTo, setReturnedTo] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);
  const storageKey = `safra:results:${locale}:${query}`;

  /* Restore once, on the way back from a property this list was left for. */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      sessionStorage.removeItem(storageKey);

      const snapshot = JSON.parse(raw) as {
        cards: CardModel[];
        cursor: string | null;
        scrollY: number;
        at: number;
        opened: string | null;
      };

      if (Date.now() - snapshot.at > RESTORE_WITHIN_MS) return;
      if (snapshot.cards.length <= initialCards.length) return;

      setCards(snapshot.cards);
      setCursor(snapshot.cursor);
      setStatus(snapshot.cursor ? 'idle' : 'done');
      setRestoredCount(snapshot.cards.length);
      /*
        INSTANT, not the page's smooth scrolling: returning to where you were is a place, not a
        journey, and a smooth scroll through five thousand pixels of cards took a second and a half
        to arrive — long enough to read as the page having lost the reader's position.
      */
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.scrollTo({ top: snapshot.scrollY, behavior: 'instant' });

          /*
            The ROW, not only the pixel. A card pressed while half off the screen would come back
            half off the screen, which is where it was and not where the reader is looking for it.
          */
          const opened = snapshot.opened
            ? document.getElementById(snapshot.opened)
            : null;
          if (opened) {
            const box = opened.getBoundingClientRect();
            if (box.top < 0 || box.bottom > window.innerHeight) {
              opened.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
            setReturnedTo(snapshot.opened);
            window.setTimeout(() => setReturnedTo(null), 2400);
          }
        }),
      );
    } catch {
      /* Storage refused or the entry is not ours: the first batch is the right fallback. */
    }
    // Once per search: a new query is a new list, mounted afresh under a new key.
  }, []);

  /*
    A heart pressed anywhere on the page lands in the cards, so the snapshot `remember` writes, and
    the list restored from it, carry what the reader actually saved (audit 2026-10-04).
  */
  useEffect(() => {
    const follow = (event: Event) => {
      const change = (event as CustomEvent<FavouriteChange>).detail;
      setCards((current) =>
        current.map((card) =>
          card.slug === change.slug ? { ...card, saved: change.saved } : card,
        ),
      );
    };

    window.addEventListener(FAVOURITE_EVENT, follow);
    return () => window.removeEventListener(FAVOURITE_EVENT, follow);
  }, []);

  const remember = useCallback(
    (opened: string | null) => {
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            cards,
            cursor,
            scrollY: window.scrollY,
            at: Date.now(),
            opened,
          }),
        );
      } catch {
        /* Full or blocked storage loses the way back, not the click. */
      }
    },
    [cards, cursor, storageKey],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || inFlight.current) return;

    inFlight.current = true;
    setStatus('loading');

    try {
      const response = await fetch(
        `/${locale}/api/search?${query}&cursor=${encodeURIComponent(cursor)}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );

      if (!response.ok) throw new Error(String(response.status));

      const batch = (await response.json()) as {
        cards: CardModel[];
        nextCursor: string | null;
        truncated: boolean;
      };

      setCards((current) => {
        /*
          De-duplicated by reference. Search pages by OFFSET, and a listing booked or published
          between two batches shifts every later row by one — without this the reader could meet
          the same hotel twice in one scroll.
        */
        const seen = new Set(current.map((card) => card.key));
        return [...current, ...batch.cards.filter((card) => !seen.has(card.key))];
      });
      setCursor(batch.nextCursor);
      setTruncated(batch.truncated);
      setStatus(batch.nextCursor ? 'idle' : 'done');
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, [cursor, locale, query]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || status === 'done' || status === 'error') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '800px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, status]);

  return (
    <>
      <ul
        className="grid gap-4"
        aria-busy={status === 'loading'}
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('a[href]')) remember(target.closest('article')?.id ?? null);
        }}
      >
        {cards.map((card, index) => (
          <li
            key={card.key}
            className={
              index >= restoredCount
                ? 'transition-[opacity,translate] duration-300 ease-out-strong starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none'
                : undefined
            }
          >
            <div
              className={`rounded-card transition-[box-shadow] duration-500 ease-out ${
                returnedTo === `result-${card.key}`
                  ? 'ring-2 ring-gold ring-offset-2 ring-offset-bg'
                  : ''
              }`}
            >
              <ResultCard card={card} signInHref={signInHref} />
            </div>
          </li>
        ))}
      </ul>

      <div ref={sentinel} aria-hidden className="h-px" />

      {status === 'loading' ? (
        <ul aria-hidden className="mt-4 grid gap-4">
          {[0, 1].map((one) => (
            <li
              key={one}
              className="grid h-56 animate-pulse overflow-hidden rounded-card border border-line bg-card motion-reduce:animate-none sm:grid-cols-[13.5rem_1fr] lg:grid-cols-[15rem_1fr]"
            >
              <div className="bg-band" />
              <div className="space-y-3 p-4">
                <div className="h-5 w-1/2 rounded bg-band" />
                <div className="h-4 w-1/3 rounded bg-band" />
                <div className="h-4 w-2/3 rounded bg-band" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {status === 'error' ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 rounded-card border border-bad/30 bg-bad/5 p-4 text-14 text-text">
          <span>{labels.loadFailed}</span>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line bg-card px-4 text-14 font-semibold text-text transition-[transform,border-color] duration-150 ease-out hover:border-gold active:scale-[0.97] motion-reduce:transition-none"
          >
            {labels.retry}
          </button>
        </div>
      ) : null}

      {status === 'done' && cards.length > 0 ? (
        <p className="mt-8 border-t border-line pt-6 text-center text-14 text-muted">
          {truncated ? truncatedLabel(cards.length) : labels.end}
        </p>
      ) : null}

      <p role="status" className="sr-only">
        {status === 'loading'
          ? labels.loading
          : status === 'done' && cards.length > 0
            ? truncated
              ? truncatedLabel(cards.length)
              : labels.end
            : ''}
      </p>
    </>
  );
}
