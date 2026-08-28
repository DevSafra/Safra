'use client';

import { useEffect, useRef } from 'react';

import type { SeenSection } from '@safra/contracts';

/**
 * Reports how far down this registry's new rows the reader has now been shown.
 *
 * ## What it sends, and why the client is the one that knows
 *
 * `readTo` is the oldest row that was ON SCREEN — a fact about the page, which only the page knows:
 * the server would have to re-run the list query with the same filter, size and page number to work
 * it out. The server takes it as a minimum, clamps it to now, and stamps the batch boundary with
 * its own clock, so nothing here is trusted beyond its shape.
 *
 * ## Why it is a client effect and not part of rendering
 *
 * Next.js PREFETCHES links. A server component that recorded the visit while rendering would let a
 * mouse passing over a sidebar item mark rows read that nobody looked at — and a prefetch is not a
 * visit. It is the same reasoning that made the rows-per-page bar a POST rather than a GET.
 *
 * The CURRENT render still shows the badge and the tint, deliberately: the report lands after this
 * page was rendered from the previous state, so the reader is shown what is new on the visit that
 * counts it as read.
 *
 * ## Once per page, and silent when it fails
 *
 * Keyed on the section AND on `readTo`, so paging re-reports — that is the whole point, each page
 * moves the frontier down. The ref guards against React's development StrictMode running the effect
 * twice for one render, where the second POST is pure noise. A failure is swallowed: a badge that
 * does not move is a cosmetic annoyance, and an error banner over a registry somebody came to read
 * would be worse than the annoyance.
 */
export function MarkSectionSeen({
  section,
  readTo,
  readFrom,
}: {
  readonly section: SeenSection;
  /**
   * The oldest row rendered on this page, ISO — or `undefined` when the page showed none.
   *
   * An empty page still reports, without a frontier: it tells the server the section was opened,
   * which is what starts the clock for a reader who has never been here.
   */
  readonly readTo?: string | undefined;
  /**
   * The newest row rendered on this page — the top of what the reader was shown.
   *
   * What the NEXT batch starts from. Without it a batch retires at the moment the reader walked
   * away, and every row that arrived while they were reading falls behind that boundary and is
   * never marked at all.
   */
  readonly readFrom?: string | undefined;
}) {
  const sent = useRef('');

  useEffect(() => {
    const key = `${section}:${readTo ?? ''}:${readFrom ?? ''}`;

    if (sent.current === key) return;

    sent.current = key;

    void fetch('/api/me/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        ...(readTo ? { readTo } : {}),
        ...(readFrom ? { readFrom } : {}),
      }),
    }).catch(() => undefined);
  }, [section, readTo, readFrom]);

  return null;
}
