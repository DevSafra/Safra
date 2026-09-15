'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A row of cards that scrolls, with the two arrows booking.com puts on theirs.
 *
 * ## Why this is the one client component on the home page
 *
 * Everything else on this page is server-rendered with no JavaScript, deliberately: the search
 * state lives in the URL, the results are indexable, and the form works before a script has
 * loaded. An arrow that scrolls a row cannot be any of that — `scrollBy` is a script — so this is
 * an isolated leaf and nothing else on the page becomes a client component because of it.
 *
 * ## It degrades to what it already was
 *
 * The arrows render only after mount. Without JavaScript, or before hydration, the row is a plain
 * `overflow-x: auto` container that a thumb, a trackpad or a Shift-wheel already scrolls — which
 * is exactly the rail this replaces. A pair of arrows painted by the server would be two controls
 * that look armed and do nothing until a script arrives; «a disabled control is a COURTESY, the
 * endpoint is the control» cuts the other way here, and the honest answer is not to draw them
 * until they work.
 *
 * ## Right-to-left
 *
 * `scrollLeft` counts DOWN from zero in an RTL container — the start is 0 and the far end is
 * negative. Reading `Math.abs()` gives a position that means the same thing in both directions, so
 * the end detection needs no branch. The step does: «next» is a negative delta in Arabic and a
 * positive one in English, and the sign is taken from the computed direction rather than from the
 * locale, because the container is what actually knows.
 *
 * The chevrons are mirrored with `rtl:rotate-180`. That is not in tension with the rule that an
 * arrow KEY means a physical direction: these are not keys, they are labels for «earlier in the
 * list» and «later in the list», and later is to the left when the list runs right to left.
 */
export function CardSlider({
  children,
  labels,
  bleed = true,
  arrowsOnPhone = false,
  arrows = 'float',
}: {
  children: React.ReactNode;
  labels: { previous: string; next: string };
  /**
   * Whether the rail runs to the container's edge, as the home page's rows do.
   *
   * `-mx-4 px-4` cancels the page's own padding so a card can sit half-off the edge and say «there
   * is more this way». Inside a PANEL there is no padding to cancel and nothing to bleed past, so
   * the rail keeps its box — see the reviews in the booking card (Bashar, 2026-09-15).
   */
  readonly bleed?: boolean;
  /**
   * Whether the arrows appear below `sm`.
   *
   * Off for a row of destinations: a phone scrolls that with a thumb, and two 40px targets
   * floating over the first and last card take a press meant for the card underneath. On where
   * the rail is ONE item wide — there is no neighbour peeking to say the rail moves, so without
   * arrows a phone reader has no way to know a second review exists.
   */
  readonly arrowsOnPhone?: boolean;
  /**
   * Where the arrows sit.
   *
   * `float` is the home page's arrangement: the pair hovers over the rail's two edges, half over
   * the first and last card. That works because those cards are PHOTOGRAPHS — a circle resting on
   * an image hides nothing anybody was reading.
   *
   * `below` is for a rail of TEXT with no room beside it. Measured on the booking panel's reviews
   * (2026-09-15): the floating arrow landed squarely on the second line of a quote and covered two
   * words. A control that hides the content it pages through is worse than one that costs a row of
   * height, so in the panel the pair sits under the rail instead.
   *
   * `side` is booking.com's own arrangement for its guest-review rail, and Bashar asked for it by
   * screenshot (2026-09-15). It is the answer to the same problem `below` solves, not a relapse
   * into it: the pair sits vertically centred and SIXTEEN PIXELS OUTSIDE the rail, so a 40px
   * button reaches exactly 24px inside — which is `p-6`, the card's own padding. Those two numbers
   * are one decision: a caller using `side` owes its cards 24px of padding, and a card that drops
   * to `p-4` puts the circle back on top of the prose.
   *
   * Measured at both edges rather than assumed, because they do not behave alike. `snap-mandatory`
   * parks a card FLUSH at the rail's start, so the «previous» arrow lands on that card's padding
   * and covers no text at all — at scroll 380 on the property page, zero overlap with any
   * paragraph. At the far edge there is no snap and the rail cuts a card mid-width, so «next»
   * covers the outermost 24px of a card the overflow has already truncated mid-sentence. That is
   * the honest description of what this placement costs: not a covered word, a narrower peek.
   *
   * Sixteen is also the largest outward shift the page can afford. Every column that hosts a rail
   * begins one page padding (`px-4`) in, so -16px lands the button flush with the viewport edge
   * and -20px would push it past — which on an RTL page means a horizontal scrollbar, and «no page
   * ever scrolls sideways» is a rule with no exceptions.
   */
  readonly arrows?: 'float' | 'below' | 'side';
}) {
  const rail = useRef<HTMLUListElement>(null);
  const [mounted, setMounted] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;

    const furthest = el.scrollWidth - el.clientWidth;
    const position = Math.abs(el.scrollLeft);

    /*
      ## The start tolerance is the rail's own padding, and that is a measured fix

      The row bleeds to the container edge with `-mx-4 px-4`, so its content begins one padding in,
      and `snap-mandatory` parks the first card's start edge on that padding rather than on the
      scroll origin. At rest the position is therefore 16, not 0 — measured — so a `position <= 1`
      test never fires and the «previous» arrow stayed visible against a row that could not move
      back. The end test was against `scrollWidth - clientWidth`, which IS the true maximum, which
      is why only one of the two arrows misbehaved and the bug looked like half a bug.

      Reading the padding rather than writing `16` keeps the two in step: the row is `px-4` at every
      width today, and a future `sm:px-6` would silently break an equality against a literal.

      The extra pixel on both ends is for zoom. A scroll position is a float once the page is
      scaled, so an exact comparison against either bound is false for ever at that bound.
    */
    const padding = Number.parseFloat(getComputedStyle(el).paddingInlineStart) || 0;

    setAtStart(position <= padding + 1);
    setAtEnd(position >= furthest - 1);
  }, []);

  useEffect(() => {
    setMounted(true);
    measure();

    const el = rail.current;
    if (!el) return;

    /*
      The row's own width decides whether the arrows are needed, and it changes without a scroll:
      a rotated phone, a resized window, a font that finished loading and made every card taller.
      `ResizeObserver` catches all three; a `resize` listener catches only the second.
    */
    const observer = new ResizeObserver(measure);
    observer.observe(el);

    return () => observer.disconnect();
  }, [measure]);

  const step = useCallback((towardsEnd: boolean) => {
    const el = rail.current;
    if (!el) return;

    const rtl = getComputedStyle(el).direction === 'rtl';
    /*
      One viewport of cards, less a sliver, so the card that was half-visible at the edge is fully
      visible after the press rather than being scrolled past. booking.com's arrows move by a page
      for the same reason.
    */
    const page = el.clientWidth * 0.85;
    const delta = (towardsEnd ? 1 : -1) * (rtl ? -1 : 1) * page;

    el.scrollBy({
      left: delta,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, []);

  return (
    <div className="relative">
      <ul
        ref={rail}
        onScroll={measure}
        className={`slider-rail flex snap-x snap-mandatory overflow-x-auto pb-1 ${
          bleed ? '-mx-4 gap-3 px-4 sm:gap-4' : 'gap-3'
        }`}
      >
        {children}
      </ul>

      {/*
        Both arrows are rendered once mounted and HIDDEN at the ends rather than disabled, which is
        what booking.com does: an arrow at the end of a row is not a control that failed, it is a
        control with nothing left to do. `pointer-events-none` goes with the fade so an invisible
        button cannot still take the click meant for the card under it.
      */}
      {mounted && arrows === 'float' ? (
        <>
          <Arrow
            label={labels.previous}
            hidden={atStart}
            onPhone={arrowsOnPhone}
            onClick={() => step(false)}
            className="absolute top-[38%] start-0 -translate-x-0 -translate-y-1/2"
          />
          <Arrow
            label={labels.next}
            hidden={atEnd}
            onPhone={arrowsOnPhone}
            onClick={() => step(true)}
            className="absolute top-[38%] end-0 -translate-y-1/2 rotate-180"
          />
        </>
      ) : null}

      {/*
        Beside the rail, centred on it, half in the gutter and half on the card's own padding.

        Hidden at the ends like the other two placements, and for the same reason: at rest the
        «previous» arrow is not drawn at all, so nothing rests on the first card until a reader has
        moved the rail and the card under the circle is a partial one anyway.
      */}
      {mounted && arrows === 'side' ? (
        <>
          <Arrow
            label={labels.previous}
            hidden={atStart}
            onPhone={arrowsOnPhone}
            onClick={() => step(false)}
            className="absolute top-1/2 start-[-16px] -translate-y-1/2"
          />
          <Arrow
            label={labels.next}
            hidden={atEnd}
            onPhone={arrowsOnPhone}
            onClick={() => step(true)}
            className="absolute top-1/2 end-[-16px] -translate-y-1/2 rotate-180"
          />
        </>
      ) : null}

      {/*
        Under the rail, at the reading START, and only the arrows that can still do something.

        Start rather than end, which was measured rather than preferred: at the first slide only
        «next» is drawn, and against `justify-end` it sat alone in the far corner with the width of
        the hidden «previous» between it and the edge — a control adrift in empty card. Under the
        first word of the quote it reads as belonging to the text it pages.

        Hidden at the ends rather than disabled, which keeps one rule for both placements: an arrow
        with nothing left to reach is not a control that failed. It still RESERVES its space, so the
        pair does not shuffle sideways as a reader moves through the rail.
      */}
      {mounted && arrows === 'below' ? (
        <div className="mt-1 flex justify-start gap-1.5">
          <Arrow
            label={labels.previous}
            hidden={atStart}
            onPhone={arrowsOnPhone}
            onClick={() => step(false)}
            className=""
          />
          <Arrow
            label={labels.next}
            hidden={atEnd}
            onPhone={arrowsOnPhone}
            onClick={() => step(true)}
            className="rotate-180"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One arrow.
 *
 * Hidden below `sm`: a phone is scrolled with a thumb, and two 40px targets floating over the
 * first and last card take a press meant for the destination underneath them.
 *
 * ## The motion, decided rather than sprinkled
 *
 * **Should it animate at all?** These are pressed occasionally — somebody browsing destinations,
 * not a control met a hundred times a day — so an entrance is affordable. A keyboard-repeated
 * action would get none.
 *
 * **What is it for?** Three moments, and each earns its own answer:
 *
 * - **Appearing and leaving.** An arrow at the end of a row has nothing left to do, and it goes.
 *   From `scale-90`, never from `scale-0`: nothing in the world appears out of nothing, and a
 *   control that pops from a point reads as a glitch rather than as an entrance.
 * - **Hover.** The surface changes and the shadow deepens. Nothing moves and nothing grows
 *   (Bashar, 2026-09-02) — a control that swells under the pointer is the pointer's target moving
 *   while it is being aimed at, and on a 40px circle 4% was enough to notice and not enough to
 *   mean anything. A surface that lifts says «pressable» without asking the eye to track an edge.
 *   Tailwind gates `hover:` behind `(hover: hover)` itself, so a thumb never triggers it.
 * - **Press.** `scale-95`, the one piece of feedback that has to be instant, because it is the
 *   interface saying it heard you. Pressing is the opposite case from hovering: the target has
 *   already been hit, so movement confirms rather than interferes.
 *
 * **Asymmetric timing.** 200ms in, 140ms out. Arriving is the part worth watching; leaving is the
 * system tidying up after itself and should not be waited on.
 *
 * ## The entrance scale is `lg:` only, and the touch floor is why
 *
 * `globals.css` forces a 40px minimum height on every control BELOW `lg`, where the input is a
 * finger. A resting `scale-90` on a 40px button renders 36px — `responsive.spec.ts` measured
 * exactly that and failed, which is the floor doing its job on a control that is momentarily
 * smaller than a fingertip.
 *
 * So below `lg` the arrow fades without travelling, and from `lg` up — where the input is a
 * pointer and the floor does not apply — it fades AND scales. A fade is still an entrance rather
 * than a pop, so nothing about the rule «never appear from nothing» is given up; what is given up
 * is 10% of scale on the widths where a 4px difference costs somebody the target.
 *
 * The button is `size-10` rather than `size-9` for the same reason from the other side: 40px is
 * the floor, and a control that only reaches it because a global rule stretches its height is one
 * refactor away from not reaching it at all.
 *
 * **Exponential ease-out on every one**, from `--ease-out-strong`. The built-in curves are too
 * gentle to read as a response, and `ease-in` is absent everywhere in this project: it withholds
 * movement at exactly the moment the eye is on the element.
 *
 * Transitions rather than keyframes, so a fast scroll that flips an arrow's state mid-animation
 * retargets from where it is instead of restarting from the beginning. `prefers-reduced-motion`
 * collapses all of it in `globals.css`, which is the right degradation here: the arrow still
 * appears and still disappears, it simply stops travelling to do it.
 */
function Arrow({
  label,
  hidden,
  onClick,
  onPhone,
  className,
}: {
  label: string;
  hidden: boolean;
  onClick: () => void;
  /** Whether this arrow is drawn below `sm` — see `arrowsOnPhone`. */
  onPhone: boolean;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      tabIndex={hidden ? -1 : 0}
      aria-hidden={hidden}
      className={`z-10 size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-card text-text shadow-[var(--shadow-lift)] transition-[opacity,box-shadow,background-color] ease-out-strong hover:bg-field hover:shadow-[var(--shadow-lift-hover)] ${
        onPhone ? 'grid' : 'hidden sm:grid'
      } ${
        hidden
          ? 'pointer-events-none opacity-0 duration-140 lg:scale-90'
          : 'opacity-100 duration-200 lg:scale-100'
      } ${className}`}
    >
      {/*
        Drawn, at the stroke every other icon on this site uses, and mirrored under RTL so it points
        at the direction of travel rather than at a fixed side of the screen.
      */}
      <svg
        aria-hidden
        width="1.05em"
        height="1.05em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="rtl:rotate-180"
      >
        <path d="m14.5 5.5-7 6.5 7 6.5" />
      </svg>
    </button>
  );
}
