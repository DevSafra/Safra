'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The sticky bar that has no background until the page moves under it.
 *
 * Bashar, 2026-09-02: «on the top it should have no background same as booking.com and on
 * scrolling, it should.»
 *
 * ## An IntersectionObserver, never a scroll listener
 *
 * A `scroll` handler runs on every frame of every scroll, on the main thread, for the whole life
 * of the page — to answer one boolean that changes twice. A one-pixel sentinel at the very top of
 * the document answers the same question from the compositor: while it is on screen the page is at
 * the top, and the moment it leaves, it is not. The browser tells us, once per crossing.
 *
 * The sentinel carries `-mb-px` against its own `h-px`, so it occupies no layout. A zero-height
 * element cannot intersect anything, which is why it is not simply `h-0`.
 *
 * ## Why the state lives here and not on the header
 *
 * `SiteHeader` reads the session, so it is a Server Component and cannot hold state. This wraps it
 * instead: the shell is the only client code, the contents stay server-rendered, and nothing else
 * in the header becomes a client component to get a background.
 *
 * ## The transition
 *
 * Background, border and shadow, 200ms on the project's one ease-out. Not transform: the bar must
 * not move, only its surface arrives.
 *
 * **The surface is translucent, not solid** (Bashar, 2026-09-03: the bar «should be a little bit
 * blur not solid white»). It is also what the design says: `--headerBg` in the handoff is
 * `rgba(250,251,254,.86)` light and `rgba(13,10,30,.82)` dark, and the prototype's own header
 * computes `backdrop-filter: blur(18px)` over an `rgba(168,122,31,.14)` hairline — sampled from
 * the file, not guessed. A solid bar cuts the page in two at the scroll line; a blurred one keeps
 * what is behind it present without letting it compete. Nothing animates on load — `stuck` starts false, which is
 * also what the server renders, so the first paint is the transparent state and there is no flash
 * of a background that then fades out.
 *
 * A reader who lands mid-page (a shared link with a fragment, a restored scroll position) gets the
 * observer's first callback immediately, so the bar is already solid before it is looked at.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinel.current;

    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (entry) setStuck(!entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={sentinel}
        aria-hidden
        className="pointer-events-none -mb-px h-px w-full"
      />

      <header
        data-stuck={stuck ? '' : undefined}
        className={`sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-200 ease-out-strong print:hidden ${
          stuck
            ? 'border-[rgba(168,122,31,0.14)] bg-[var(--header-bg)] shadow-[var(--shadow-lift)] backdrop-blur-[18px]'
            : 'border-transparent bg-transparent'
        }`}
      >
        {children}
      </header>
    </>
  );
}
