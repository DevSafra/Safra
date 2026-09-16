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
/**
 * How long the rail must be still before its arrows answer for where it IS again.
 *
 * Long enough to outlast the gap between two frames of a smooth scroll and the snap correction
 * that can follow one; short enough that a reader who flicks the rail with a thumb and stops does
 * not see the arrows lag behind their own hand.
 */
const SETTLE_MS = 160;

/**
 * How near an edge counts as being at it.
 *
 * TWO pixels, not one. `scrollWidth` and `clientWidth` are integers while `scrollLeft` is a float,
 * so the arithmetic maximum can sit up to a pixel beyond any position the rail can actually reach —
 * and on a display with a fractional device pixel ratio, up to two. A one-pixel test can therefore
 * be unsatisfiable at the very end of the rail, which is the one place it is asked, and the arrow
 * would come back to life the moment the prediction above was released.
 */
const EDGE_SLACK = 2;

export function CardSlider({
  children,
  labels,
  footers,
  bleed = true,
  arrowsOnPhone = false,
  arrows = 'float',
}: {
  children: React.ReactNode;
  labels: { previous: string; next: string };
  /**
   * One node per slide, of which the slider shows the one belonging to the slide in view.
   *
   * It exists because the booking panel's attribution has to sit BELOW the arrows (Bashar,
   * 2026-09-16: «the buttons should be under the comment and above the name»), and a name that
   * belongs to a particular review cannot be written once under a rail that pages through six.
   * So the caller hands over the rendered nodes — elements, not a function, because a server
   * component cannot pass a callback across the client boundary — and the slider picks.
   *
   * It is NODES rather than strings so every word and every class stays in the caller's file;
   * a caption styled inside a shared slider is a string living where the next language never
   * looks. The panel passes `<figcaption>`s and wraps the slider in a `<figure>`, so the pair is
   * still a quotation with an attribution rather than two unrelated lines.
   *
   * The index is tracked only when this is given — it costs a rect per slide per scroll event,
   * which is nothing for six and not nothing for a home page of twenty destinations.
   */
  readonly footers?: readonly React.ReactNode[];
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
   * `below` is a row of BARE chevrons under the rail — no disc, no border, no shadow — followed by
   * `footers`. It is what the booking panel came back to (Bashar, 2026-09-16: «remove the rounded
   * circle around them and keep only the arrows… the buttons should be under the comment and above
   * the name, so we will not have the comment in the center»). Flanking the quote had squeezed a
   * 320px panel's text into 230px; under it, the quote is full width again and the pager reads as
   * a pager rather than as two objects pinning the words in place.
   *
   * The two end states differ from the disc's on purpose. A disc that has nothing left to reach is
   * HIDDEN — a circle disappearing from the edge of a photograph leaves a clean edge. A bare
   * chevron that disappears leaves a hole in a row of two glyphs and reads as a rendering fault,
   * so this one is `disabled` and dimmed instead: still a pair, still legible as «two directions,
   * one of them unavailable», and the keyboard skips it because the attribute is real.
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
  /*
    Which slide the rail is showing. Zero on the server and on the first client render, which is
    the slide a reader sees before touching anything — so the caption under the arrows is right
    from the first paint rather than arriving with the JavaScript.
  */
  const [active, setActive] = useState(0);
  /*
    Where a pressed arrow is taking the rail, until it arrives.

    A smooth scroll takes a few hundred milliseconds, and `measure()` runs off the scroll events it
    produces — so «there is nothing after this» used to become true only once the animation had
    finished, and the arrow sat there live and pressable over a rail with nowhere left to go
    (Bashar, 2026-09-16: «make it immediately disabled when there is no item next»). Reading this
    first answers for the DESTINATION rather than the position, from the moment of the press.

    It has to be a destination rather than a distance, which is why `step` computes the snap offset
    it is scrolling TO: a rail that moves 0.85 of its width and then snaps to a card boundary ends
    up somewhere the press did not name, and «is that the end» answered against the un-snapped
    figure is wrong exactly at the end, which is the one place it is being asked.
  */
  const pending = useRef<number | null>(null);
  /*
    The prediction is released when the rail STOPS, not when it arrives.

    It used to be released by comparing the live position against the target, and that is the flicker
    Bashar saw on the last quote (2026-09-16): «the button gets deactivated, activated and then
    deactivated very fast». A position test has to be exact to within a pixel, and a scroll position
    is a float that a snap correction, a fractional device pixel ratio or another engine's smooth
    scroller can leave a hair away from the number this code chose — at which point the prediction
    is dropped mid-animation, the arrow answers for where the rail IS rather than where it is going,
    and it lights up for one frame before the scroll finishes and puts it out again.

    Waiting for silence needs no such luck. Every scroll event pushes this timer out, so it fires
    once the rail has been still for `SETTLE_MS`, whatever route it took to get there.
  */
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tracksActive = footers !== undefined;

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;

    const furthest = el.scrollWidth - el.clientWidth;
    const live = Math.abs(el.scrollLeft);
    const position = pending.current ?? live;

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

    setAtStart(position <= padding + EDGE_SLACK);
    setAtEnd(position >= furthest - EDGE_SLACK);

    /*
      The slide nearest the rail's START edge, found by comparing rectangles rather than by
      dividing the scroll by a slide width. A rail whose slides are one width each could be
      divided; this one cannot promise that — the reviews section's cards are narrower than the
      rail and the home page's are narrower still — and a formula that is right for one caller and
      quietly wrong for another is the shape this component keeps being asked to avoid.
    */
    if (!tracksActive) return;

    const rtl = getComputedStyle(el).direction === 'rtl';
    const edge = rtl ? el.getBoundingClientRect().right : el.getBoundingClientRect().left;

    let nearest = 0;
    let shortest = Number.POSITIVE_INFINITY;

    [...el.children].forEach((child, index) => {
      const box = child.getBoundingClientRect();
      const distance = Math.abs((rtl ? box.right : box.left) - edge);

      if (distance < shortest) {
        shortest = distance;
        nearest = index;
      }
    });

    setActive(nearest);
  }, [tracksActive]);

  /** Drop the prediction and re-answer from where the rail actually is. */
  const release = useCallback(() => {
    if (settle.current !== null) {
      clearTimeout(settle.current);
      settle.current = null;
    }

    pending.current = null;
    measure();
  }, [measure]);

  /** Push the release out; a rail still moving is a rail still going where it was sent. */
  const postpone = useCallback(() => {
    if (pending.current === null) return;

    if (settle.current !== null) clearTimeout(settle.current);

    settle.current = setTimeout(release, SETTLE_MS);
  }, [release]);

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

    return () => {
      observer.disconnect();

      /* A timer that fires into an unmounted component sets state on nothing. */
      if (settle.current !== null) clearTimeout(settle.current);
    };
  }, [measure]);

  const step = useCallback(
    (towardsEnd: boolean) => {
      const el = rail.current;
      if (!el) return;

      const rtl = getComputedStyle(el).direction === 'rtl';
      const furthest = el.scrollWidth - el.clientWidth;
      const position = Math.abs(el.scrollLeft);

      /*
        One viewport of cards, less a sliver, so the card that was half-visible at the edge is fully
        visible after the press rather than being scrolled past. booking.com's arrows move by a page
        for the same reason.
      */
      const page = el.clientWidth * 0.85;
      const desired = Math.min(
        Math.max(position + (towardsEnd ? page : -page), 0),
        furthest,
      );

      /*
        Every position at which a slide would park flush against the rail's start — the snap points
        the browser itself would choose between. Read from rectangles rather than from
        `offsetLeft`, because the start edge is the RIGHT one in Arabic and `offsetLeft` does not
        know that. Clamped, so the tail slides that can never park flush all collapse onto the true
        maximum instead of naming a position the rail cannot reach.
      */
      const box = el.getBoundingClientRect();
      const stops = [...el.children].map((child) => {
        const slide = child.getBoundingClientRect();
        const shift = rtl ? box.right - slide.right : slide.left - box.left;

        return Math.min(Math.max(position + shift, 0), furthest);
      });

      /*
        The stop nearest where a page-scroll would have landed — and never the one the rail is
        already on, so a press always moves. If nothing lies ahead there is nothing to do, and the
        arrow that was pressed is about to be the one that goes quiet.
      */
      const ahead = stops.filter((stop) =>
        towardsEnd ? stop > position + 1 : stop < position - 1,
      );

      const target = ahead.length
        ? ahead.reduce((best, stop) =>
            Math.abs(stop - desired) < Math.abs(best - desired) ? stop : best,
          )
        : desired;

      /* Answer for the destination NOW; the scroll can take its few hundred milliseconds. */
      pending.current = target;
      measure();
      /*
        Armed here as well as on every scroll event, because a press that cannot move the rail —
        already at the end, or a target the engine rounds to where it already is — produces no
        scroll events at all, and the prediction would otherwise be held for ever.
      */
      postpone();

      el.scrollTo({
        left: rtl ? -target : target,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    },
    [measure, postpone],
  );

  return (
    <div className="relative">
      <ul
        ref={rail}
        onScroll={() => {
          measure();
          postpone();
        }}
        /*
          A thumb, a drag or a trackpad takes the rail somewhere the last press did not promise, so
          the prediction above is abandoned the moment somebody touches it — otherwise a scroll
          interrupted halfway would leave the arrows describing a destination nobody is travelling
          to any more.
        */
        onPointerDown={release}
        onWheel={release}
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
        Under the rail, at the reading START, both of them, always.

        `-ms-[11px]` is optical alignment and it is arithmetic rather than taste: the chevron is
        18px inside a 40px target, so its glyph sits 11px in from the invisible box's edge. Without
        the pull the first arrow hangs a finger's width past the quote above it — the box lines up
        and the thing a person can SEE does not. The target keeps its 40px because below `lg` the
        input is a thumb.
      */}
      {mounted && arrows === 'below' ? (
        <div className="-ms-[11px] mt-2 flex items-center">
          <Arrow
            label={labels.previous}
            hidden={atStart}
            onPhone={arrowsOnPhone}
            onClick={() => step(false)}
            bare
            className=""
          />
          <Arrow
            label={labels.next}
            hidden={atEnd}
            onPhone={arrowsOnPhone}
            onClick={() => step(true)}
            bare
            className="rotate-180"
          />
        </div>
      ) : null}

      {/*
        The slide's own footer, under the arrows — the panel's attribution. Rendered whether or not
        the script has arrived: a quotation with no name under it is worse for the half-second
        before hydration than a name that a pre-hydration thumb-scroll could leave one slide stale.
      */}
      {footers ? footers[active] : null}
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
  bare = false,
  className,
}: {
  label: string;
  hidden: boolean;
  onClick: () => void;
  /** Whether this arrow is drawn below `sm` — see `arrowsOnPhone`. */
  onPhone: boolean;
  /**
   * A chevron with nothing under it, for a row sitting on a plain surface.
   *
   * The disc is not decoration where it is kept: over a photograph or over the edge of a card it
   * is the only thing giving a white chevron a background to be legible against. Under a quote
   * there is already a background, and the circle was one painted shape too many — so this variant
   * drops the border, the fill and the shadow and answers the pointer with COLOUR, and the press
   * with the 95% scale that a surface change can no longer carry.
   */
  bare?: boolean;
  className: string;
}) {
  /*
    A bare arrow at the end of the rail stays and dims; a disc leaves. See the `below` note on
    `arrows` — a two-glyph row with one glyph missing reads as broken, and `disabled` is the honest
    way to say «nothing that way» because the keyboard and a screen reader both get told.
  */
  const skin = bare
    ? `group text-muted transition-[opacity,color] ease-out-strong hover:text-gold-read ${
        hidden ? 'opacity-30 duration-140' : 'opacity-100 duration-200'
      }`
    : `border border-line bg-card text-text shadow-[var(--shadow-lift)] transition-[opacity,box-shadow,background-color] ease-out-strong hover:bg-field hover:shadow-[var(--shadow-lift-hover)] ${
        hidden
          ? 'pointer-events-none opacity-0 duration-140 lg:scale-90'
          : 'opacity-100 duration-200 lg:scale-100'
      }`;

  /*
    ## The press lives on the GLYPH, and its resting size when spent is the pressed one

    Both halves of that are a fix for what Bashar saw (2026-09-16): «the button gets deactivated,
    activated and then deactivated very fast», on the press that reaches the last quote.

    It was `active:scale-95` on the button. A DISABLED element stops matching `:active`, so the
    moment that press retired the control the scale sprang back — measured: 0.95 → 1 over 180ms,
    beginning at full opacity, while the fade had barely started. A control growing at the instant
    it is pressed reads as coming back to life, which is the one thing it is not doing.

    So the pressed size is also the SPENT size: pressing takes the chevron to 90%, and an arrow
    with nothing left to reach rests there and fades. Nothing travels backwards, and the class flip
    at that moment changes no computed value, so there is no transition to see.

    On the glyph rather than the button because the button is the TARGET. `globals.css` holds a
    control to 40px below `lg`, and a scale on the button is how the disc above came to need a
    `lg:` guard to stay a fingertip wide. A chevron may shrink to any size it likes; the box a
    thumb is aiming at may not.
  */
  const glyph = bare
    ? `transition-transform duration-140 ease-out-strong ${
        hidden ? 'scale-90' : 'scale-100 group-active:scale-90'
      }`
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={bare && hidden}
      tabIndex={!bare && hidden ? -1 : 0}
      aria-hidden={!bare && hidden}
      className={`z-10 size-10 shrink-0 place-items-center rounded-full ${
        bare && hidden ? 'cursor-default' : 'cursor-pointer'
      } ${onPhone ? 'grid' : 'hidden sm:grid'} ${skin} ${className}`}
    >
      {/*
        Drawn, at the stroke every other icon on this site uses, and mirrored under RTL so it points
        at the direction of travel rather than at a fixed side of the screen. The bare one is drawn
        heavier: a chevron with no disc under it has to hold the eye on its own.
      */}
      <svg
        aria-hidden
        width={bare ? '1.25em' : '1.05em'}
        height={bare ? '1.25em' : '1.05em'}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={bare ? 2.1 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`rtl:rotate-180 ${glyph}`}
      >
        <path d="m14.5 5.5-7 6.5 7 6.5" />
      </svg>
    </button>
  );
}
