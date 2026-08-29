'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Reports that an agent has actually read this thread.
 *
 * ## Why the badge could not be worked down
 *
 * `unread_for_staff` was cleared by a REPLY and by a CLOSE and by nothing else. A thread read and
 * judged to need no answer stayed counted for ever, so the number beside الرسائل only ever went up
 * — which is the opposite of what a queue badge is for. Reading is taking, the same answer
 * «استلام» gives on النزاعات.
 *
 * ## Why a client effect and not the page's own GET
 *
 * Next PREFETCHES a link the mouse passes over. Clearing the counter while rendering would let a
 * pointer crossing the inbox mark threads read that nobody opened — and the counter is ONE number
 * shared by every agent, so that is not a private mistake. Same reasoning, and the same shape, as
 * `MarkSectionSeen`.
 *
 * ## It refreshes once, and only when something changed
 *
 * The sidebar is server-rendered, so the badge on THIS page is stale the moment the POST succeeds.
 * `read: true` means a counter actually moved; refreshing on `false` would re-render every visit to
 * an already-read thread for no change at all.
 */
export function MarkThreadRead({ reference }: { readonly reference: string }) {
  const router = useRouter();
  const reported = useRef('');

  useEffect(() => {
    /* StrictMode runs an effect twice for one render; the second POST is pure noise. */
    if (reported.current === reference) return;

    reported.current = reference;

    void (async () => {
      try {
        const response = await fetch(
          `/api/conversations/${encodeURIComponent(reference)}/read`,
          { method: 'POST' },
        );

        if (!response.ok) return;

        const payload: unknown = await response.json().catch(() => null);

        if (
          typeof payload === 'object' &&
          payload !== null &&
          'read' in payload &&
          payload.read === true
        ) {
          router.refresh();
        }
      } catch {
        /*
          Swallowed. A badge that has not moved is a cosmetic annoyance; an error banner over a
          thread somebody came to read would be worse than the annoyance.
        */
      }
    })();
  }, [reference, router]);

  return null;
}
