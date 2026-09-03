'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** One picture in a slider. `id` keys it; `thumb` is the tile and `full` is what the frame shows. */
export interface SliderImage {
  readonly id: string;
  readonly thumb: string;
  readonly full: string;
  /** Shown under the frame — a file name, a room, whatever names this picture. */
  readonly caption?: string | undefined;
  /** A short pill beside the caption: «الغلاف», «من العميل». */
  readonly badge?: string | undefined;
}

/**
 * Every word the slider says, from the caller's own catalogue.
 *
 * Required rather than defaulted, for the reason `PasswordField` gives: a default here would be an
 * English string living in a shared package, invisible to the task of adding a language.
 *
 * The redesign of 2026-09-02 added `zoomIn`/`zoomOut` and nothing else — the thumbnail rail names
 * its buttons with `open` plus the position, which is what the tiles have always done, so the rail
 * arrived without touching a catalogue. The zoom controls could not: they are two new things a
 * person reads, and required-rather-than-defaulted is what forces all five catalogues to answer for
 * them instead of an English string appearing in a shared package.
 */
export interface SliderLabels {
  /** The dialog's accessible name — «صور العقار», «أدلة النزاع». */
  readonly title: string;
  /** Prefixes a tile's accessible name: «معاينة ٣». */
  readonly open: string;
  readonly previous: string;
  readonly next: string;
  readonly close: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
}

/**
 * The project's one ease-out, written out rather than referenced.
 *
 * `--ease-out-strong` is defined in the customer app's `globals.css` and in neither of the other
 * two, so a shared component that used the token would animate correctly on one surface out of
 * three and silently fall back to `linear` on the rest. Same class of mistake as the `text-text2`
 * this file used to carry: a shared package may only spend what all three apps have.
 */
const EASE_OUT = 'cubic-bezier(0.23,1,0.32,1)';

/**
 * The surround a photograph is read against.
 *
 * Pinned dark in BOTH themes, and that is a decision about the use scene rather than about the
 * palette: this surface exists for looking at a photograph, and a near-black surround is what stops
 * the page's own white from competing with the picture's own whites. Every photo viewer worth the
 * name does this. It is `#0a0c11` and not `#000` — pure black flattens the darkest parts of a
 * photograph against the void behind them and removes the frame's own edge.
 */
const SURROUND = '#0a0c11';

/**
 * How far in the buttons go.
 *
 * Four stops, not a continuous range: these are BUTTONS, and a button that moves by an
 * unpredictable amount is one people press twice to find out what it did. 3× is the ceiling because
 * beyond it a 1600px render is mush, and a control whose result is mush is worse than no control.
 */
const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

/**
 * The one image previewer — «معاينة».
 *
 * ## Why there is exactly one of these
 *
 * Standing instruction from Bashar (2026-08-30): a slider is built ONCE and used everywhere. Before
 * it, four surfaces showed photographs four ways — the console's property review had a real
 * lightbox, dispute evidence opened a raw file in a new tab, the partner's image manager had
 * thumbnails and nothing else, and the customer's property page had its own gallery. Each one
 * learnt keyboard handling, focus and scroll-locking separately, or did not learn them at all.
 *
 * ## Two exports, because half the callers draw their own tiles
 *
 * `ImageSlider` is tiles plus the frame, for a plain gallery. `ImageSliderFrame` is the frame
 * alone, for a caller whose tiles carry controls of their own — dispute evidence puts «استبدال»
 * and «حذف» under each photograph, and an ad creative has exactly one picture and a form around
 * it. Both share this file's keyboard, focus and scroll behaviour, which is the whole point.
 *
 * ## What the 2026-09-02 redesign changed, and what it found
 *
 * Bashar asked for this component to be designed properly. Four of the five things it needed were
 * defects rather than taste, and every one was measured on the running customer site first:
 *
 * - **The controls were 30×23px.** They asked for `min-w-10`/`min-h-10` and computed `0`. Not
 *   specificity — `globals.css` carried `:where(.grid, .flex, .inline-flex) > * { min-width: 0 }`
 *   OUTSIDE a cascade layer, and an unlayered rule beats every Tailwind utility whatever the
 *   specificity says. 23px is under WCAG 2.5.8's 24×24 floor, on a modal dialog, in all three apps.
 *   Fixed at the source by layering that rule; the note beside it had claimed the opposite since
 *   Tailwind v4 landed, and a previous session had already met the defect on الإعلانات and worked
 *   around it locally rather than reporting it.
 * - **The caption was not muted on the customer site.** `text-text2` is defined in the console and
 *   the portal and NOT in the customer app, so the declaration was invalid and the caption
 *   inherited full text colour — measured identical to the position counter beside it. `muted` is
 *   the token all three define. `confirm-dialog.tsx` had the same line and the same bug.
 * - **Tab walked out of the dialog.** `aria-modal` tells a screen reader; it traps nothing. The
 *   trap here is `Modal`'s, queried per keystroke for the reason recorded there.
 * - **A photograph used 44% of the screen.** The frame was `max-w-5xl` with an unsized `<img>`, so
 *   a 1600px source rendered at its intrinsic width in the middle of a 1440px viewport. It now
 *   fills what the chrome leaves.
 * - **Glyph controls.** `‹`, `›` and `×` were text standing in for an icon system, which is the one
 *   thing the craft floor names outright. They are drawn now, one stroke weight, one size.
 *
 * ## Motion: the frame animates, stepping does not
 *
 * That asymmetry is the whole motion design, and it comes from asking how often a person sees each
 * one. **Opening** is occasional — a customer opens the gallery once, a reviewer opens it per
 * property — so it gets a 200ms ease-out, which stops a full-screen dark surface from appearing out
 * of nothing. **Stepping** is not: a staff reviewer walks fourteen photographs with the arrow keys
 * dozens of times a day, and animating a key-repeated action is how an interface starts to feel
 * slow. So a step is instantaneous, and the work went into making instantaneous *possible* — the
 * neighbouring pictures are preloaded, so the swap has no blank frame to cover up.
 *
 * **Closing is instant too**, which is deliberately not symmetric with opening: it is most often
 * Escape or a backdrop click, both of which mean «put me back», and an exit animation on a
 * full-screen overlay delays the page underneath for no information gained.
 *
 * ## The viewer is physical; only its words follow the page
 *
 * Four things can move through the set — the arrow keys, the two chevrons, a drag, and the rail —
 * and they must all agree. The standing rule settles which way: **arrows are NOT mirrored on an RTL
 * screen**, because an arrow key means the direction of travel through a list rather than a reading
 * direction, and mirroring makes the keyboard disagree with itself when the same person opens the
 * customer site.
 *
 * Extending that to the whole surface is what makes it coherent rather than merely compliant. `→`
 * and the right-hand chevron and a leftward drag and the next thumbnail to the right are one
 * gesture expressed four ways. The alternative — mirroring the chevrons to follow reading order —
 * puts «التالي» on the left of an Arabic screen while `→` still advances, so the screen and the
 * keyboard point opposite ways.
 *
 * **The consequence, accepted and stated:** the thumbnail rail runs left to right on an Arabic page.
 * It is `dir="ltr"` deliberately, because a rail whose order disagreed with the arrows would put the
 * highlight travelling leftward when somebody pressed the right-hand control. A strip of
 * photographs is not prose. Everything that IS language — the caption, the badge, the labels —
 * stays in the page's own direction.
 */
export function ImageSliderFrame({
  images,
  at,
  onChange,
  labels,
}: {
  readonly images: readonly SliderImage[];
  /** The index being shown, or `null` when the frame is closed. */
  readonly at: number | null;
  readonly onChange: (at: number | null) => void;
  readonly labels: SliderLabels;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  /*
    The entrance runs from the closed state, so it cannot be a class on the first render — the
    element mounts already open. One frame later this flips and the transition has something to
    travel from. `@starting-style` would express it in CSS, and is not reached for here because
    this package is consumed by three apps whose Tailwind variants are not guaranteed to match.
  */
  const [shown, setShown] = useState(false);

  /**
   * How far in, and where the picture has been pulled to.
   *
   * Discrete steps rather than a continuous range, because these are BUTTONS: a slider would need a
   * track and a thumb and a value nobody wants to read, and a button that moves by an unpredictable
   * amount is a button people press twice to see what happens. 1×, 1.5×, 2×, 3× is enough to read a
   * room's fittings on a phone and stops before the source turns to mush.
   *
   * `offset` is where the picture sits inside its frame, in pixels, and it exists because **zoom
   * without panning is broken** — magnifying the middle of a photograph and refusing to show the
   * rest is a control that appears to work and does not. It is clamped to the overflow, so the
   * picture cannot be dragged off its own frame and lost.
   */
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const close = useCallback(() => onChange(null), [onChange]);

  /*
    Both controls re-CENTRE. Keeping a pan across a zoom change means pressing «تصغير» can leave the
    picture parked off to one side with empty frame beside it, which reads as the viewer having lost
    the photograph. Panning is what the drag is for; the buttons answer «how close», not «where».
  */
  const stepZoom = useCallback((by: 1 | -1) => {
    setZoom((current) => {
      const index = ZOOM_STEPS.indexOf(current as (typeof ZOOM_STEPS)[number]);
      const next = index < 0 ? 1 : index + by;

      return ZOOM_STEPS[Math.min(Math.max(next, 0), ZOOM_STEPS.length - 1)] ?? 1;
    });
    setOffset({ x: 0, y: 0 });
  }, []);

  /* Double-click is the gesture everybody tries on a photograph, so it is the shortest way in and out. */
  const toggleZoom = useCallback(() => {
    setZoom((current) => (current === 1 ? 2 : 1));
    setOffset({ x: 0, y: 0 });
  }, []);

  /*
    Clamps rather than wraps, and the arrows disappear at the ends.

    It wrapped until 2026-09-02, when the picture area became a real TRACK — the pictures sit side by
    side and the track slides between them, which is what makes a drag show the neighbour arriving
    under the finger instead of nothing happening until you let go. Wrapping in that model means the
    last picture slides all the way back past every other one to reach the first, which reads as the
    viewer losing its place.

    booking.com's own gallery does not wrap either. And a control with nowhere to go HIDES rather
    than greying out, which is the behaviour Bashar asked for on the home page's sliders — same
    question, so the same answer.
  */
  const step = useCallback(
    (by: number) => {
      if (at === null || images.length === 0) return;

      const next = at + by;

      if (next < 0 || next > images.length - 1) return;

      onChange(next);
    },
    [at, images.length, onChange],
  );

  /*
    The position, in the reader's own digits.

    «٣ / ١٤» on an Arabic screen and «3 / 14» on a German one. The locale is read from the document
    rather than passed, because this component has no locale prop and adding one would change five
    catalogues to say something the page already knows. Safe from a hydration mismatch: the frame
    renders only after somebody opens it, so there is no server render of this string to disagree
    with.
  */
  const digits = useMemo(() => {
    try {
      const lang =
        typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en';

      return new Intl.NumberFormat(lang);
    } catch {
      return new Intl.NumberFormat('en');
    }
  }, []);

  useEffect(() => {
    if (at === null) return undefined;

    const raf = requestAnimationFrame(() => setShown(true));

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();

        return;
      }

      if (event.key === 'ArrowRight') {
        step(1);

        return;
      }

      if (event.key === 'ArrowLeft') {
        step(-1);

        return;
      }

      /*
        The characters the keyboard actually produces. `+` needs Shift on most layouts and arrives
        as `+`; the unshifted key on the same cap is `=`, which is what people press. Both mean in.
      */
      if (event.key === '+' || event.key === '=') {
        stepZoom(1);

        return;
      }

      if (event.key === '-' || event.key === '_') {
        stepZoom(-1);

        return;
      }

      if (event.key === '0') {
        setZoom(1);
        setOffset({ x: 0, y: 0 });

        return;
      }

      if (event.key !== 'Tab') return;

      /*
        The trap, matching `Modal`'s: everything focusable inside, in document order, queried per
        keystroke rather than cached. The rail's buttons change with the picture set, and a stale
        list would trap focus on an element that is no longer there.

        Without this, `aria-modal="true"` announced a modal to a screen reader while Tab walked
        straight out of it into the page behind — which is modal in appearance only.
      */
      const focusable = frame.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href]',
      );

      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    /* The page behind must not scroll while a full-screen frame is over it. */
    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    /*
      Focus moves INTO the frame, and the element that had it is remembered so it can be given back.
      A reader who opens a picture with the keyboard and closes it should be where they were, not at
      the top of the document.
    */
    const returnTo = document.activeElement;

    frame.current?.focus();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      setShown(false);
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
    /*
      `at` is in the list so the trap and the key handler see the current index through `step`.
      Re-running is cheap and it is what keeps `step` from closing over a stale position.
    */
  }, [at, close, step, stepZoom]);

  /*
    The neighbours, fetched before they are asked for.

    This is what pays for having no step animation. A picture that is already decoded swaps in the
    same frame the key was pressed; one that is not shows the frame empty for as long as the network
    takes, which is the flicker an animation would otherwise be hiding. Both neighbours, because a
    reader walks backwards as often as forwards. They are also the two the track has mounted beside
    the current one, so this is the same pair the slide animation is about to reveal.
  */
  useEffect(() => {
    if (at === null || images.length < 2 || typeof Image === 'undefined') return;

    for (const by of [1, -1]) {
      const neighbour = images[at + by];

      if (neighbour) new Image().src = neighbour.full;
    }
  }, [at, images]);

  /*
    A new picture arrives at 1×, always.

    Carrying the zoom across would land somebody on a photograph they have not seen, magnified into
    a corner of it, with no cue that they are not looking at the whole thing. Every viewer that gets
    this right resets; the ones that do not are the ones people describe as «it went weird».
  */
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [at]);

  /* The active thumbnail is brought into view — instantly, because stepping is a keyboard action. */
  useEffect(() => {
    if (at === null) return;

    rail.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [at]);

  /*
    Both narrowed together, so the frame renders only when there is an index AND a picture at it.
    Reading `at` below is then safe without a second null check.
  */
  const current = at === null ? undefined : images[at];

  if (current === undefined || at === null) return null;

  return (
    <div
      role="presentation"
      /* The backdrop closes, which is what everybody tries first. */
      onClick={close}
      style={{ backgroundColor: SURROUND, transitionTimingFunction: EASE_OUT }}
      className={`fixed inset-0 z-[70] flex flex-col transition-opacity duration-200 motion-reduce:transition-none ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        tabIndex={-1}
        /* Clicks inside the frame must not reach the backdrop's handler. */
        onClick={(event) => event.stopPropagation()}
        style={{ transitionTimingFunction: EASE_OUT }}
        className={`flex h-full w-full flex-col outline-none transition-transform duration-200 motion-reduce:transition-none ${
          shown ? 'scale-100' : 'scale-[0.985]'
        }`}
      >
        {/*
          The bar sits ABOVE the picture in a column rather than over it. A scrim over the top of a
          photograph is the usual answer and it is a worse one: it darkens the picture to make the
          chrome legible, which is backwards on a surface that exists to show the picture.
        */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-3 text-[12.5px] text-white sm:px-4">
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {/*
              The position, isolated as its own left-to-right run so «٣ / ١٤» lays out correctly on
              a right-to-left line without the slash migrating.
            */}
            <span dir="ltr" className="shrink-0 tabular-nums text-white/70">
              {digits.format(at + 1)} / {digits.format(images.length)}
            </span>
            {current.caption ? (
              <span className="truncate text-white/60">{current.caption}</span>
            ) : null}
            {current.badge ? (
              <span className="shrink-0 rounded-full bg-white/12 px-2 py-0.5 text-[10.5px] font-semibold text-gold ring-1 ring-white/15">
                {current.badge}
              </span>
            ) : null}
          </span>

          {/*
            Beside «إغلاق», not floating over the picture. The chevrons sit on the photograph because
            they are about the photograph; these are about the VIEW of it, which is what the bar is
            for — and a third cluster of controls over the image would start to be the thing you
            look at.

            `disabled` rather than hidden, which is the opposite of the choice the chevrons make and
            is right for the opposite reason: a chevron that vanishes tells you there is nothing
            further that way, while a zoom pair that changed width as you used it would move the
            control you were about to press next.
          */}
          <span className="flex shrink-0 items-center gap-1.5">
            <Control
              onClick={() => stepZoom(-1)}
              label={labels.zoomOut}
              icon="zoomOut"
              disabled={zoom <= 1}
            />
            <Control
              onClick={() => stepZoom(1)}
              label={labels.zoomIn}
              icon="zoomIn"
              disabled={zoom >= (ZOOM_STEPS.at(-1) ?? 3)}
            />
            <Control onClick={close} label={labels.close} icon="close" />
          </span>
        </div>

        {/* ── The picture ─────────────────────────────────────────────────── */}
        <Track
          images={images}
          at={at}
          onStep={step}
          onDismiss={close}
          zoom={zoom}
          offset={offset}
          onPan={setOffset}
          onToggleZoom={toggleZoom}
          radius="rounded-card"
        >
          {images.length > 1 ? (
            <>
              {/*
                At the edges, vertically centred, and placed PHYSICALLY — `left`/`right`, not
                `start`/`end`, which is the one place in this codebase where the logical property is
                the wrong tool. «السابق» belongs under the same hand as `←` on every screen; see the
                note on the frame. Each carries its own pill background: unlike the bar, these DO sit
                over the picture, and a bare white glyph on an unknown photograph is the
                ghost-button-over-photography case with no contrast guarantee at all.

                A control with nowhere to go is absent rather than disabled — the first picture has
                no «السابق». A greyed-out arrow is a map of what you may not do; an absent one simply
                tells the truth, and it is what the home page's sliders already do.
              */}
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-2 sm:pl-4">
                {at > 0 ? (
                  <Control
                    onClick={() => step(-1)}
                    label={labels.previous}
                    icon="previous"
                    className="pointer-events-auto"
                  />
                ) : null}
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center pr-2 sm:pr-4">
                {at < images.length - 1 ? (
                  <Control
                    onClick={() => step(1)}
                    label={labels.next}
                    icon="next"
                    className="pointer-events-auto"
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </Track>

        {/* ── The rail ────────────────────────────────────────────────────── */}
        {images.length > 1 ? (
          <div
            ref={rail}
            /*
              Where the position counter says «٣ / ١٤», this says which three and which fourteen. It
              is the difference between knowing how far through you are and being able to get
              somewhere: fourteen photographs stepped one at a time is a search, and a reviewer
              checking whether a listing has a photograph of the bathroom should not have to walk
              the set to find out.

              The scrollbar is themed rather than hidden. Hiding it removes the only cue that there
              is more rail than fits; browser chrome nobody styles is the cheapest tell that a
              surface was assembled rather than designed.
            */
            dir="ltr"
            className="shrink-0 overflow-x-auto px-3 py-3 [scrollbar-color:rgba(255,255,255,0.28)_transparent] [scrollbar-width:thin] sm:px-4"
          >
            {/*
              Centred, by an inner track that is only as wide as its thumbnails. Left-aligned it sat
              in the corner of a 1440px screen under a picture that is itself centred, which reads as
              a strip that failed to lay out rather than as a deliberate edge.

              `mx-auto` and not `justify-center` on the scroller: a centred flex container whose
              content overflows makes the first item unreachable in several browsers, because the
              overflow is distributed to both sides and one of them is not scrollable. An auto margin
              collapses to zero the moment the track is wider than the box, so a long set scrolls
              from its true start and a short one sits in the middle.
            */}
            <div className="mx-auto flex w-fit gap-2">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  /*
                    `data-thumb` names the control independently of the words on it. The rail's
                    accessible name is the caller's «معاينة الصورة ٢» / «Foto ansehen 2», so a
                    browser test written against the label only works in the language it was
                    written in — the reasoning that put `data-status-pill` on the console's pills.
                  */
                  data-thumb=""
                  data-active={index === at}
                  onClick={() => onChange(index)}
                  aria-label={`${labels.open} ${index + 1}`}
                  aria-current={index === at ? 'true' : undefined}
                  style={{ transitionTimingFunction: EASE_OUT }}
                  className="group relative h-12 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg outline-none ring-1 ring-white/15 transition-[opacity,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-gold data-[active=false]:opacity-55 data-[active=true]:ring-2 data-[active=true]:ring-gold data-[active=false]:hover:opacity-100 motion-reduce:transition-none"
                >
                  <img
                    src={image.thumb}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The pictures, side by side, and the track that slides between them.
 *
 * ## Why a track and not a swapped `src`
 *
 * Bashar, 2026-09-02: «the arrows buttons are not working and can you please add an animation to
 * it? … similar to the booking.com image preview slider.» Both halves of that land here.
 *
 * A viewer that swaps one `<img>`'s source can fade, and it can never do the thing a slider does:
 * show you the next picture arriving under your finger while you are still dragging. The pictures
 * are laid out at multiples of the frame's width and the track is translated by `-at × 100%`, so
 * stepping is one transform and a drag is the same transform following the pointer. That is what
 * booking.com's gallery does and it is why theirs feels like a strip of photographs rather than a
 * slideshow.
 *
 * **Only three are mounted** — the current picture and its two neighbours, each positioned at its
 * own index. Fourteen 1600px photographs in the DOM at once is a lot of decoded bitmap for a set
 * somebody will look at three of, and the window is exactly the pair `ImageSliderFrame` preloads.
 *
 * ## The animation, and the rule it is traded against
 *
 * Stepping deliberately did NOT animate: a reviewer walks a set with the arrow keys dozens of times
 * a day, and animating a key-repeated action is how an interface starts to feel slow. Bashar asked
 * for the animation explicitly, so it is here — kept to 260ms on one ease-out, which is fast enough
 * that a held arrow key still feels like stepping rather than waiting, and dropped entirely under
 * `prefers-reduced-motion`.
 *
 * ## The bug this replaced
 *
 * The gesture used to live on a wrapper that called `setPointerCapture` on every press. Capturing
 * retargets every later pointer event to the capturing element, so `pointerup` never reached the
 * chevron a person had pressed — and a `click` only fires when down and up share a target. **The
 * arrows did nothing at all**, which is what Bashar reported. They were placed correctly, so the
 * spec that checked where they sat passed; nothing checked that pressing one did anything.
 *
 * The guard is one line: a press that starts on a control is not a drag. It is written as
 * `closest('button, a[href]')` rather than a check against the two chevrons, because the next
 * caller to put a control over a picture must not have to rediscover this.
 */
function Track({
  images,
  at,
  onStep,
  onDismiss,
  zoom,
  offset,
  onPan,
  onToggleZoom,
  radius,
  children,
}: {
  readonly images: readonly SliderImage[];
  readonly at: number;
  readonly onStep: (by: number) => void;
  readonly onDismiss: () => void;
  readonly zoom: number;
  readonly offset: { x: number; y: number };
  readonly onPan: (offset: { x: number; y: number }) => void;
  readonly onToggleZoom: () => void;
  readonly radius: string;
  readonly children: React.ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    at: number;
    /** Set once the pointer has travelled far enough that this is a drag and not a press. */
    moving: boolean;
  } | null>(null);
  const panned = useRef(offset);

  /**
   * How far the picture may be pulled before its own edge leaves the frame.
   *
   * Measured from the PICTURE, not from the element. The image fills its slide and `object-contain`
   * letterboxes the photograph inside it, so a landscape shot in a tall frame has bars above and
   * below that are part of the element and not part of the picture. Clamping to the element would
   * let somebody drag the photograph off and sit looking at the bar.
   */
  const reach = useCallback(() => {
    const image = picture.current;

    if (!image || zoom <= 1) return { x: 0, y: 0 };

    const box = image.getBoundingClientRect();
    const shown = Math.min(
      box.width / zoom / image.naturalWidth,
      box.height / zoom / image.naturalHeight,
    );
    const wide = image.naturalWidth * shown * zoom;
    const tall = image.naturalHeight * shown * zoom;

    return {
      x: Math.max(0, (wide - box.width / zoom) / 2),
      y: Math.max(0, (tall - box.height / zoom) / 2),
    };
  }, [zoom]);

  const hold = (value: number, limit: number) => Math.min(Math.max(value, -limit), limit);

  panned.current = offset;

  const resting = `translate3d(${-at * 100}%, 0, 0)`;

  /* Only the current picture and its neighbours — see the note above. */
  const mounted = images
    .map((image, index) => ({ image, index }))
    .filter(({ index }) => Math.abs(index - at) <= 1);

  const release = useCallback((element: HTMLElement) => {
    element.style.transition = '';
    element.style.opacity = '';
  }, []);

  return (
    <div
      className="relative min-h-0 flex-1 touch-pan-y overflow-hidden"
      onPointerDown={(event) => {
        /*
          A press that starts on a control is not a drag. Without this the capture below swallows
          the chevron's click entirely — see the note above.
        */
        if ((event.target as HTMLElement).closest('button, a[href]')) return;

        /* One pointer, and a mouse only by its primary button. */
        if (drag.current !== null) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        /*
          The pointer is NOT captured here, and that is the whole point.

          Capturing on press retargets every later pointer event to this element, so `pointerup`
          never reaches what was actually pressed — and both a `click` and a `dblclick` need down and
          up on one target. That is what stopped the chevrons working, and it silently stopped
          double-press-to-zoom too. Capture happens on the first real MOVEMENT instead, below: a
          press that goes nowhere stays an ordinary press, and a drag still keeps its pointer when
          the finger leaves the frame.
        */
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          at: performance.now(),
          moving: false,
        };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        const element = track.current;

        if (start === null || event.pointerId !== start.id || !element) return;

        /* Below the threshold this is still a press, and a press must be allowed to become a click. */
        if (!start.moving) {
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;

          start.moving = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }

        /*
          Magnified, a drag MOVES THE PICTURE. Stepping or dismissing here would be the viewer
          answering a different question from the one the hand asked: a finger on a photograph that
          is bigger than its frame means «show me the rest of this one».
        */
        if (zoom > 1) {
          const limit = reach();
          const next = {
            x: hold(panned.current.x + event.clientX - start.x, limit.x),
            y: hold(panned.current.y + event.clientY - start.y, limit.y),
          };
          const image = picture.current;

          if (image) {
            image.style.transition = 'none';
            image.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${zoom})`;
          }

          return;
        }

        const dx = event.clientX - start.x;
        /* Downward only: there is nothing above the picture, and a two-way throw is one people trigger by accident. */
        const dy = Math.max(0, event.clientY - start.y);

        /*
          Written straight to the element rather than held in state. A React render per pointer frame
          drops frames on exactly the devices this exists for.

          Damped at the ends instead of stopped dead: the first and last pictures have nothing beyond
          them, and a strip that simply refuses to move reads as a broken screen, where one that
          gives a third of a finger's travel reads as an edge.
        */
        const beyond = (dx > 0 && at === 0) || (dx < 0 && at === images.length - 1);
        const travel = beyond ? dx / 3 : dx;

        element.style.transition = 'none';
        element.style.transform = `translate3d(calc(${-at * 100}% + ${travel}px), ${dy}px, 0)`;
        /* Fading with the pull is what says «letting go here will close this». */
        element.style.opacity = String(1 - Math.min(dy / 420, 0.55));
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        const element = track.current;

        if (start === null || event.pointerId !== start.id || !element) return;

        const moved = start.moving;

        drag.current = null;

        /* A press that went nowhere is a click, and the browser is about to deliver it. */
        if (!moved) return;

        /* A pan commits where the picture was left; the transition comes back for the next change. */
        if (zoom > 1) {
          const limit = reach();
          const image = picture.current;

          if (image) image.style.transition = '';

          onPan({
            x: hold(panned.current.x + event.clientX - start.x, limit.x),
            y: hold(panned.current.y + event.clientY - start.y, limit.y),
          });

          return;
        }

        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        const elapsed = Math.max(1, performance.now() - start.at);

        release(element);

        /* Whichever axis the person actually meant. */
        if (dy > Math.abs(dx) && (dy > 130 || dy / elapsed > 0.11)) {
          element.style.transform = resting;
          onDismiss();

          return;
        }

        /*
          Velocity, not only distance: a quick flick means «onward» even when it travelled 40px, and
          that is how every photo viewer a person has used behaves.

          Leftward is onward on every screen. The strip is physical here for the same reason the
          chevrons and the keys are — see the note on the frame — so this needs no reading of the
          document's direction and cannot disagree with the control beside it.
        */
        const meant =
          Math.abs(dx) > Math.abs(dy) &&
          (Math.abs(dx) > 60 || Math.abs(dx) / elapsed > 0.11);
        const by = meant ? (dx < 0 ? 1 : -1) : 0;
        const target = Math.min(Math.max(at + by, 0), images.length - 1);

        /*
          The transform is set imperatively as well as by the render below. A drag that does NOT
          commit changes no state, so React never re-renders and the inline transform the move
          handler wrote would stay — the strip would sit where the finger left it.
        */
        element.style.transform = `translate3d(${-target * 100}%, 0, 0)`;

        if (by !== 0) onStep(by);
      }}
      onPointerCancel={(event) => {
        const element = track.current;

        if (drag.current?.id !== event.pointerId || !element) return;

        drag.current = null;
        release(element);
        element.style.transform = resting;
      }}
    >
      <div
        ref={track}
        style={{ transform: resting, transitionTimingFunction: EASE_OUT }}
        className="absolute inset-0 transition-[transform,opacity] duration-[260ms] motion-reduce:transition-none"
      >
        {mounted.map(({ image, index }) => (
          <div
            key={image.id}
            /*
              The neighbours are mounted so the track can slide onto them, and they are not the
              picture being shown. `aria-hidden` keeps a screen reader from announcing three
              photographs where a person sees one, and `data-current` gives every other reader —
              a test included — one honest way to ask which is on screen.
            */
            data-current={index === at}
            aria-hidden={index !== at}
            style={{ left: `${index * 100}%` }}
            className="absolute inset-y-0 flex w-full items-center justify-center px-2 sm:px-4"
          >
            {/*
              `size-full object-contain`, not `max-w-full`. A `max-*` cap only ever shrinks: the old
              frame let the picture render at its intrinsic width, so a source sat 640px wide in the
              middle of a 1440px screen and used 44% of it. Filling the box and letterboxing inside
              it is what makes the space the frame reserves actually reach the photograph.

              The contract that follows: `full` must be a LARGE render, because this will scale one
              up. The customer gallery asks for 1600px and the partner portal for its `large`
              variant, so the only sources that upscale today are the placeholder fixtures — a
              content gap, not a component one.

              `draggable={false}` so a mouse drag moves the strip instead of starting the browser's
              own image drag and fighting it.

              `alt=""` stays: the picture IS the content, and a description invented here would be a
              claim about somebody's room that nobody made. The caption above names it, and the
              dialog carries its own accessible name.
            */}
            <img
              {...(index === at ? { ref: picture } : {})}
              src={image.full}
              alt=""
              draggable={false}
              onDoubleClick={index === at ? onToggleZoom : undefined}
              style={
                index === at && zoom !== 1
                  ? {
                      transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
                      transitionTimingFunction: EASE_OUT,
                    }
                  : { transitionTimingFunction: EASE_OUT }
              }
              /*
                `cursor-zoom-in` / `grab` say what the picture will do before it is touched, which is
                the whole job of a cursor. Only the current slide carries the zoom: the neighbours
                are mounted so the track can slide onto them and must arrive at 1×.
              */
              className={`size-full object-contain transition-transform duration-200 select-none motion-reduce:transition-none ${radius} ${
                index === at
                  ? zoom > 1
                    ? 'cursor-grab active:cursor-grabbing'
                    : 'cursor-zoom-in'
                  : ''
              }`}
            />
          </div>
        ))}
      </div>

      {children}
    </div>
  );
}

/**
 * Tiles that open the frame — the plain gallery, for a caller with nothing else to draw.
 *
 * `renderBadge` puts a marker on a TILE (the console marks the cover photograph); the frame shows
 * `badge` for the picture it is displaying, because at full size a tile's corner is off screen.
 */
export function ImageSlider({
  images,
  labels,
  tileClassName = 'h-24 w-32',
}: {
  readonly images: readonly SliderImage[];
  readonly labels: SliderLabels;
  /** The tile size, so a dense card and a review screen can differ without a second component. */
  readonly tileClassName?: string;
}) {
  const [at, setAt] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <ul className="mt-3 flex flex-wrap gap-2">
        {images.map((image, index) => (
          <li key={image.id} className="relative">
            {/*
              The press answers. A tile that a person taps and that does nothing until the frame
              appears reads as a slow screen rather than a busy one; `active:scale` is the cheapest
              honest acknowledgement there is. Hover is gated on a real pointer, because a touch
              device fires hover on tap and would leave the tile stuck in its hovered state.
            */}
            <button
              type="button"
              onClick={() => setAt(index)}
              aria-label={`${labels.open} ${index + 1}`}
              style={{ transitionTimingFunction: EASE_OUT }}
              className="block cursor-pointer overflow-hidden rounded-lg outline-none ring-1 ring-line transition-[box-shadow,scale] duration-200 focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.98] motion-reduce:transition-none hover:[@media(hover:hover)and(pointer:fine)]:ring-gold/60"
            >
              <img
                src={image.thumb}
                alt=""
                loading="lazy"
                className={`${tileClassName} object-cover`}
              />
            </button>
            {image.badge ? (
              <span className="pointer-events-none absolute start-1 top-1 rounded-full bg-bg/85 px-2 py-0.5 text-[10px] text-gold ring-1 ring-gold/25">
                {image.badge}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <ImageSliderFrame images={images} at={at} onChange={setAt} labels={labels} />
    </>
  );
}

/**
 * One control in the frame.
 *
 * ## Drawn, not typed
 *
 * These were `‹`, `›` and `×` — text characters standing in for an icon system, which is the single
 * thing the craft floor names outright. Three glyphs from the page's Arabic text face, at whatever
 * weight and optical size that face gives them, next to nothing else that looks like them. They are
 * one 1.75-weight stroke set now, drawn at one size.
 *
 * ## And they are 44px, which they were not
 *
 * `min-w-10 min-h-10 lg:min-h-0` computed to `0` in every app — see the note on the frame. `size-11`
 * states the box outright rather than flooring it, so there is nothing left for a cascade layer to
 * win against, and 44px is the target size Apple and WCAG both settle on rather than the 24×24
 * minimum that merely passes.
 *
 * The pill is what makes a white glyph legible over a photograph nobody has seen: a translucent
 * dark fill, a hairline ring for the edge where the photograph behind is also dark, and a blur so
 * the fill reads as a surface rather than as a stain.
 *
 * The fill is 55% and not 45%, and that came from measuring the worst case rather than looking at
 * it. Against a PURE WHITE photograph — the hardest thing this pill will ever sit on — 45% put the
 * glyph at 3.06:1, over WCAG's 3:1 floor for a control by four hundredths. 55% makes it 4.8:1, and
 * costs nothing anywhere else because the pill is already dark against the surround.
 */
function Control({
  onClick,
  label,
  icon,
  disabled = false,
  className = '',
}: {
  readonly onClick: () => void;
  readonly label: string;
  readonly icon: IconName;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{ transitionTimingFunction: EASE_OUT }}
      /*
        A control at its limit is dimmed and unpressable rather than gone. `disabled:opacity-40` is
        the visible half; `disabled:cursor-not-allowed` is the half that answers before the press.
      */
      className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-black/55 text-white outline-none ring-1 ring-white/25 backdrop-blur-[2px] transition-[background-color,color,scale,box-shadow,opacity] duration-200 focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none hover:not-disabled:[@media(hover:hover)and(pointer:fine)]:bg-black/70 ${className}`}
    >
      <Icon name={icon} />
    </button>
  );
}

/**
 * The three marks, one stroke.
 *
 * The path is drawn pointing LEFT, so «السابق» uses it bare and «التالي» is the same path flipped.
 * Neither carries an `rtl:` variant, and that is the decision rather than an oversight: these
 * chevrons name a physical direction, so they point the same way on an Arabic page as on a German
 * one, exactly as `←` and `→` do. See the note on the frame for the whole argument.
 */
type IconName = 'previous' | 'next' | 'close' | 'zoomIn' | 'zoomOut';

function Icon({ name }: { readonly name: IconName }) {
  const common = {
    'aria-hidden': true,
    width: '1.25rem',
    height: '1.25rem',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (name === 'close') {
    return (
      <svg {...common}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  }

  /*
    One lens, two states, drawn on the same 24px grid and the same 1.75 stroke as the chevrons and
    the cross — which is the whole reason they are drawn rather than typed. A magnifier with a bar
    through it and one with a cross read as a pair at 20px; a `+`/`−` alone reads as arithmetic.
  */
  if (name === 'zoomIn' || name === 'zoomOut') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6.25" />
        <path d="M15.6 15.6 20 20" />
        <path d="M8.4 11h5.2" />
        {name === 'zoomIn' ? <path d="M11 8.4v5.2" /> : null}
      </svg>
    );
  }

  return (
    <svg {...common} className={name === 'next' ? '-scale-x-100' : undefined}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}
