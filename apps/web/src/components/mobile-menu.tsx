'use client';

import { useEffect, useRef, useState } from 'react';

import { Modal } from '@safra/ui';

/**
 * The header's menu on a phone (Bashar, 2026-09-03).
 *
 * ## What it is for, measured rather than assumed
 *
 * The bar carried eight things — a wordmark, two destinations, a partner link, a language control,
 * a currency control and two auth buttons — and below `md` they wrapped. At 390px that was two
 * rows and **108px**; at 320px it was three rows and **152px**, which is a sixth of the viewport
 * spent on navigation before a single stay is visible, on every page of the site. Collapsing the
 * eight into one control returns all of it.
 *
 * ## Why the panel is `Modal` and not a drawer of its own
 *
 * Escape, the focus trap, returning focus to the trigger, locking the page behind it and the
 * backdrop are five things a menu has to get right and every hand-rolled one gets partly wrong.
 * They already live in `Modal`, which is why `ConfirmDialog` and the language popup sit inside it
 * too. This adds a PLACEMENT to that shell rather than a second implementation of it.
 *
 * A sheet from the top edge, not a side drawer. A side drawer has to know which side the reading
 * starts on and mirror itself between Arabic and German; a sheet moves on the one axis that has no
 * reading direction, and it drops from the bar it belongs to, which is where the reader's eye
 * already is.
 *
 * ## The icon animates because it is the state
 *
 * Two bars that rotate into a cross, on the same 200ms ease-out the rest of the product uses. Not
 * decoration: the button is the only thing on screen that says whether the menu is open, so the
 * transition IS the answer to «did that work». A swap between two icons would say the same thing
 * and say it as a flicker.
 *
 * The middle bar fades rather than rotating with the others — three bars converging on a cross is
 * a well-known way to make a cross look thick and slightly wrong at small sizes.
 *
 * **And the button stays visible while the menu is open**, which is what makes the morph worth
 * drawing. The first build put the sheet over the bar: the reader pressed a hamburger, it vanished
 * under a panel, and the only ways out were Escape and a backdrop nobody can see is tappable. The
 * bar is now lifted above the overlay and the sheet hangs below it.
 */
export function MobileMenu({
  labels,
  children,
  className = '',
}: {
  readonly labels: { open: string; close: string; title: string };
  /** Where the button sits in the bar — the caller's placement, not this component's. */
  readonly className?: string;
  /**
   * What goes IN the menu, rendered by the server.
   *
   * The links, the pickers and the account controls are all server-rendered already — some of them
   * read the session — so they are passed through rather than rebuilt here. This component owns
   * the opening and closing and nothing else, which is what keeps it the only client code the
   * header gained.
   */
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /*
    The sheet's own close, so pressing the button while it is open PLAYS the exit rather than
    yanking the panel out of the tree. `setOpen(false)` from here would unmount the shell in the
    same frame and the animation Bashar asked for would only ever run on the way in.
  */
  const closeHandleRef = useRef<(() => void) | null>(null);

  /*
    Two facts published to CSS while the menu is open, both about the BAR rather than the menu.

    `--sheet-top` is the bar's height, so the panel hangs beneath it instead of over it. Measured
    rather than hardcoded: the bar is 68px on a phone and 76px from `md`, and it will change again
    the next time somebody touches its padding.

    `data-menu-open` lifts the bar above the overlay — see `globals.css`. Both are cleaned up on
    close AND on unmount, because a navigation that happens while the menu is open would otherwise
    leave the attribute on `<html>` for the life of the document.
  */
  useEffect(() => {
    const root = document.documentElement;

    if (!open) {
      root.removeAttribute('data-menu-open');
      root.style.removeProperty('--sheet-top');

      return;
    }

    const bar = document.querySelector('header');

    root.style.setProperty(
      '--sheet-top',
      `${Math.round(bar?.getBoundingClientRect().height ?? 0)}px`,
    );
    root.setAttribute('data-menu-open', '');

    return () => {
      root.removeAttribute('data-menu-open');
      root.style.removeProperty('--sheet-top');
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? closeHandleRef.current?.() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? labels.close : labels.open}
        data-menu="mobile"
        /*
          44px, which is the target size a finger needs and the floor `globals.css` sets below
          `lg`. `md:hidden` rather than a `sm:` breakpoint: the full bar fits on one row from 768px
          up — measured, not guessed — and that is exactly Tailwind's `md`.
        */
        className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-text transition-colors duration-200 ease-out-strong hover:bg-gold/10 md:hidden ${className}`}
      >
        <MenuIcon open={open} />
      </button>

      {open ? (
        <Modal
          title={labels.title}
          onClose={() => setOpen(false)}
          placement="sheet"
          closeHandleRef={closeHandleRef}
        >
          {/*
            A press on a LINK closes it, and only on a link.

            Every anchor in here navigates, and a menu still standing over the page you just asked
            for is the commonest fault in this pattern — so it is delegated rather than wired per
            child, and the children stay unaware they are inside a menu.

            **Not on every click**, which is what this was and it broke the currency control
            silently. The currency chips are submit buttons in a POST form; closing on their click
            unmounted the form in the same tick, and the browser had nothing left to submit. No
            request was made, no error appeared, and the menu closed looking exactly as if it had
            worked. A submit reloads the page anyway, which takes the menu with it.
          */}
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('a')) setOpen(false);
            }}
            className="grid gap-1"
          >
            {children}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Two bars into a cross.
 *
 * Drawn rather than taken from an icon set, for the reason the flags are: this is four lines of
 * SVG and it has to animate, which a font glyph or a static import cannot do.
 *
 * The bars are `<rect>`s with a rounded cap rather than `<line>`s, so they keep their weight when
 * they rotate — a stroked line's cap geometry shifts under a transform and the cross comes out
 * with one arm visibly shorter.
 *
 * `transform-box: fill-box` with a centred origin is what makes each bar rotate about ITSELF. The
 * default origin is the SVG's own coordinate system, which swings the bars around the corner of
 * the viewBox instead — the classic broken version of this animation.
 */
function MenuIcon({ open }: { open: boolean }) {
  /*
    `transition-[transform,translate,rotate]`, because Tailwind v4 emits `rotate-45` and
    `translate-y-[5px]` as the standalone `rotate` and `translate` properties. Naming only
    `transform` transitions nothing at all here — the bars snapped between the two shapes, which is
    precisely the flicker the morph exists to avoid.
  */
  const bar =
    'origin-center transition-[transform,translate,rotate] duration-200 ease-out-strong [transform-box:fill-box] motion-reduce:transition-none';

  return (
    <svg
      aria-hidden
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="currentColor"
      className="shrink-0"
    >
      <rect
        x="2"
        y="5"
        width="18"
        height="2"
        rx="1"
        className={`${bar} ${open ? 'translate-y-[5px] rotate-45' : ''}`}
      />
      {/*
        The middle bar is the one that goes. It fades and shrinks toward its own centre rather than
        joining the rotation, because three bars stacked on a diagonal read as a thick smudge at
        22px.
      */}
      <rect
        x="2"
        y="10"
        width="18"
        height="2"
        rx="1"
        className={`origin-center transition-[opacity,transform,scale] duration-200 ease-out-strong [transform-box:fill-box] motion-reduce:transition-none ${
          open ? 'scale-x-0 opacity-0' : ''
        }`}
      />
      <rect
        x="2"
        y="15"
        width="18"
        height="2"
        rx="1"
        className={`${bar} ${open ? '-translate-y-[5px] -rotate-45' : ''}`}
      />
    </svg>
  );
}
