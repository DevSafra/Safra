'use client';

import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';

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
}) {
  const frame = useRef<HTMLDivElement>(null);

  const close = useCallback(() => onClose(), [onClose]);

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

  return (
    <div
      role="presentation"
      onClick={close}
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/70 p-4"
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
        className={`my-auto grid w-full ${width} gap-3 rounded-[14px] border border-line bg-card p-5 text-start shadow-2xl outline-none`}
      >
        {children}
      </div>
    </div>
  );
}
