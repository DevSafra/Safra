'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

/**
 * The pagination bar's form, submitted without moving the page (Bashar, 2026-08-25).
 *
 * ## What was wrong
 *
 * The bar is a plain HTML form, so pressing تطبيق is a POST, a redirect and a full navigation. The
 * browser resets scroll on a navigation, and the redirect carries `#pager-<section>` to put the
 * reader back on the control they just pressed — which is right on a short table and wrong on a long
 * one: applying 100 rows made the fragment land at the foot of a hundred-row table, so the whole
 * page appeared to jump to the bottom.
 *
 * ## Two mechanisms for two runtimes, exactly as the arrows already do
 *
 * The step arrows are `<Link scroll={false}>` with a fragment in the href: with JavaScript the
 * viewport does not move at all, and without it the browser follows the fragment and lands on the
 * bar rather than at the top. This gives the form the same pair. A submit intercepted here POSTs,
 * follows the redirect the endpoint chooses, and hands the resulting URL to `router.replace` with
 * `scroll: false`, so nothing moves. With JavaScript off the `action`/`method` attributes below are
 * what the browser uses, unchanged, and the fragment is the fallback.
 *
 * **`204` means the endpoint decided nothing could change**, so there is nothing to navigate to and
 * the page is left completely alone — see the route.
 *
 * ## Why the URL is taken from the RESPONSE and not rebuilt here
 *
 * The endpoint decides where a submit lands: it clamps the page, drops an unusable size, carries the
 * sibling table's position and refuses a section that is not allow-listed. Recomputing any of that
 * in the browser would be a second answer to a question that already has one, and the two would
 * drift. `response.url` is where the redirect actually went.
 */
export function PagerForm({
  action,
  className,
  children,
}: {
  readonly action: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <form
      action={action}
      method="post"
      className={className}
      onSubmit={(event) => {
        /*
          Only when this really can be handled here. `fetch` and `FormData` are the two things the
          interception needs; if either is missing the default submit is left to happen.
        */
        if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

        const form = event.currentTarget;

        event.preventDefault();

        if (busy) return;

        setBusy(true);

        void (async () => {
          try {
            const response = await fetch(action, {
              method: 'POST',
              body: new FormData(form),
            });

            /* Nothing to apply. The page stays exactly as it is — no navigation at all. */
            if (response.status === 204) return;

            const target = new URL(response.url);

            /*
              The fragment is dropped: it exists for the no-JavaScript path, and following it here
              would reintroduce the jump this component was written to remove.
            */
            router.replace(`${target.pathname}${target.search}`, { scroll: false });
          } catch {
            /*
              The network failed. Fall back to the ordinary submit rather than swallowing the
              reader's press — they chose a size and are owed either the size or an honest reload.
            */
            form.submit();
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      {children}
    </form>
  );
}
