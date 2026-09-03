'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * How long the shell takes to leave, and the only place that number lives.
 *
 * The ENTRANCE is a transition on a class, so its duration is in the class list. The exit has to
 * be a number here as well, because React unmounts a component the instant its caller stops
 * rendering it — so the shell holds itself on screen for exactly as long as the transition it is
 * playing, and not a frame longer.
 *
 * 160ms out against 220ms in, deliberately. A thing arriving should be watched; a thing leaving is
 * already decided, and matching the two makes dismissal feel slower than the decision was.
 */
const LEAVE_MS = 160;

/**
 * The one modal shell — a box over the page that the keyboard cannot walk out of.
 *
 * ## Why it exists separately from `ConfirmDialog`
 *
 * A confirmation asks a question with two buttons; an editor is a form. They are different
 * contents in the same container, and the container is the part that is easy to get wrong:
 * Escape, the backdrop, the focus trap, returning focus, and stopping the page behind from
 * scrolling. Written twice, one of them drifts — the lesson `ImageSlider` and `useConfirm` are
 * already here for. `ConfirmDialog` renders inside this, so there is one implementation.
 *
 * ## Modal means modal
 *
 * Tab is trapped, because a popup the keyboard can leave is modal in appearance only: the reader
 * tabs into the page behind it, presses Enter on something they cannot see, and the popup is still
 * open over whatever that did. Focus moves in on open and returns to where it was on close.
 */
export function Modal({
  title,
  onClose,
  children,
  labelledBy,
  width = 'max-w-2xl',
  role,
  describedBy,
  initialFocus,
  placement = 'center',
  closeHandleRef,
}: {
  /** The accessible name. Rendered as the heading unless the caller draws its own. */
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Set when the caller renders its own heading and wants it to be the label. */
  readonly labelledBy?: string | undefined;
  readonly width?: string | undefined;
  /**
   * `alertdialog` for a question that interrupts, `dialog` for a form somebody opened.
   *
   * The difference is not cosmetic: a screen reader announces an `alertdialog`'s description
   * immediately, which is right for «this deletes 4 listings» and wrong for an eight-field editor
   * it would read aloud before the person has looked at it.
   */
  readonly role?: 'dialog' | 'alertdialog' | undefined;
  readonly describedBy?: string | undefined;
  /**
   * What receives the focus on open, when the FRAME is the wrong answer.
   *
   * The frame is the right default — a screen reader is then read the dialog's label before its
   * contents. It is wrong for a destructive question, where the focus is what protects somebody:
   * «إلغاء» must be under the Enter key, so `ConfirmDialog` hands its cancel button here.
   *
   * A prop rather than `autoFocus` on the child, because a child's effect runs BEFORE its
   * parent's in React: `autoFocus` set the focus and this component's own effect then took it
   * straight back to the frame. The suite caught exactly that — a danger popup opened with the
   * focus on nothing, and Enter did nothing rather than cancelling.
   */
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
  /**
   * Where the shell sits, and therefore where it comes from.
   *
   * `center` is a box over the page — a question, an editor — and it scales up from its own centre
   * because it is anchored to nothing. `sheet` is a panel that drops from the top edge, full
   * width, for a menu that belongs to the bar it opens under: it moves along one axis, which is
   * the axis the reader's eye is already on, and it needs no mirroring on an RTL page because
   * vertical motion has no reading direction.
   *
   * A sheet clears `--sheet-top`, which the opener sets to the height of whatever it hangs from.
   * Without it the panel covered the bar, and the control the reader had just pressed — now an X,
   * and the only visible way back — was underneath it.
   */
  readonly placement?: 'center' | 'sheet' | undefined;
  /**
   * Somewhere for a trigger OUTSIDE the shell to reach its close.
   *
   * The phone menu's button stays on screen while the menu is open and becomes its X, so pressing
   * it has to do what Escape and the backdrop do — including playing the exit. Setting the
   * caller's own state to false instead would unmount this component mid-frame and the panel would
   * vanish rather than leave.
   *
   * A ref rather than a second `open` prop: the timing lives here, once, and a caller that does not
   * need it passes nothing.
   */
  readonly closeHandleRef?: RefObject<(() => void) | null> | undefined;
}) {
  const frame = useRef<HTMLDivElement>(null);
  /*
    `false` on the first render and `true` one frame later, which is what makes the entrance a
    TRANSITION rather than a jump: the element must be painted in its from-state before the class
    that moves it is applied. `requestAnimationFrame` is the guarantee that it was.
  */
  const [shown, setShown] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => setShown(true));

    return () => cancelAnimationFrame(frameId);
  }, []);

  /**
   * Play the exit, then tell the caller.
   *
   * Guarded against re-entry: Escape during the exit, or a second backdrop click, would otherwise
   * queue a second `onClose` and a second timer against a component that is already going.
   *
   * **Reduced motion skips the wait entirely**, rather than playing a shorter one. Somebody who
   * has asked for no animation is asking for the result, and 160ms of nothing happening is worse
   * than the animation they turned off.
   */
  const close = useCallback(() => {
    if (leaving.current) return;

    leaving.current = true;

    const instant =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (instant) {
      onClose();

      return;
    }

    setShown(false);
    window.setTimeout(onClose, LEAVE_MS);
  }, [onClose]);

  useEffect(() => {
    if (!closeHandleRef) return;

    closeHandleRef.current = close;

    return () => {
      closeHandleRef.current = null;
    };
  }, [close, closeHandleRef]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();

        return;
      }

      if (event.key !== 'Tab') return;

      /*
        Everything focusable inside, in document order. Queried per keystroke rather than cached:
        a form's fields change as it is used — a select revealing a field, an error appearing — and
        a stale list would trap focus on an element that is no longer there.
      */
      const focusable = frame.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
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

    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    const returnTo = document.activeElement;

    /*
      The FRAME by default, not the first field: focusing an input would start a screen reader
      mid-form, past the heading that says what this is. A caller that needs a specific control
      focused — a destructive question's «إلغاء» — names it with `initialFocus`.
    */
    (initialFocus?.current ?? frame.current)?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [close, initialFocus]);

  const sheet = placement === 'sheet';

  const shell = (
    /*
      The backdrop fades on its own timing. It is the thing that says «the page behind is not
      yours right now», so it arrives with the panel rather than after it — but it is not what the
      eye follows, so it gets opacity and nothing else.
    */
    <div
      role="presentation"
      onClick={close}
      className={`fixed inset-0 z-[60] grid overflow-y-auto bg-black/70 transition-opacity duration-200 ease-out-strong motion-reduce:transition-none ${
        sheet ? 'place-items-start pt-[var(--sheet-top,0px)]' : 'place-items-center p-4'
      } ${shown ? 'opacity-100' : 'opacity-0'}`}
    >
      <div
        ref={frame}
        role={role ?? 'dialog'}
        aria-modal="true"
        {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': title })}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        tabIndex={-1}
        /* Clicks inside must not reach the backdrop's handler. */
        onClick={(event) => event.stopPropagation()}
        /*
          The property list names `translate` and `scale` as well as `transform`, and that is not
          belt-and-braces — it is the bug this shipped with for one build. **Tailwind v4 emits
          `translate-y-4` and `scale-96` as the standalone CSS `translate` and `scale` properties,
          not as a `transform`**, so `transition-[opacity,transform]` animated the opacity and
          teleported the position. Measured, not read: `getComputedStyle(panel).transform` says
          `none` on an element that is visibly offset.

          Still not `transition-all`: `all` would animate the border and shadow too, and on a panel
          that is also scrolling its own contents that is paint work for no visible gain.

          The centred box scales from 0.96 — never from zero, because nothing in the world appears
          out of nothing, and a box that grows from a point reads as a bug rather than as an
          arrival. The sheet has no scale at all: it is already full width, so scaling it would
          stretch the type on the way in.

          `motion-reduce:` collapses both to a plain appearance, which is the whole point of the
          preference.
        */
        className={`grid w-full text-start outline-none transition-[opacity,transform,translate,scale] duration-200 ease-out-strong motion-reduce:transition-none ${
          sheet
            ? 'max-h-[88svh] gap-3 overflow-y-auto rounded-b-card border-b border-line bg-card p-5 pb-7 shadow-[0_18px_40px_-18px_rgba(15,18,32,0.45)]'
            : `my-auto ${width} gap-3 rounded-card border border-line bg-card p-5 shadow-2xl`
        } ${
          shown
            ? 'translate-y-0 scale-100 opacity-100'
            : sheet
              ? '-translate-y-4 opacity-0'
              : 'translate-y-1 scale-[0.96] opacity-0'
        }`}
      >
        {children}
      </div>
    </div>
  );

  /**
   * A sheet is portalled to `<body>`; a centred box is not.
   *
   * `z-index` only orders siblings within a stacking context, and this shell renders wherever its
   * caller does. The phone menu's opener lives INSIDE `<header>`, which is `position: sticky` with
   * a `z-index` and therefore its own context — so the backdrop, a descendant of that header, sat
   * above the hamburger no matter what the header's own `z-index` was raised to. The button was
   * dimmed under its own overlay and could not be clicked. A portal is the fix for that, not a
   * larger number.
   *
   * The centred placement deliberately stays where it is rendered. Nothing depends on it escaping,
   * and moving every dialog in three apps to `<body>` would change what `footer [role="dialog"]`
   * and its like select — real coverage, retargeted for a problem those dialogs do not have.
   */
  return sheet ? createPortal(shell, document.body) : shell;
}
