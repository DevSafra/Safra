'use client';

import { useEffect, useRef, useState } from 'react';

/** How long the message stays before it leaves on its own. */
const HOLD_MS = 2400;
/** The exit, and the only place that number lives — it has to match the class below. */
const LEAVE_MS = 180;

export type ToastTone = 'ok' | 'bad';

export interface ToastMessage {
  readonly text: string;
  readonly tone: ToastTone;
}

/**
 * A short confirmation that appears ABOVE the control that caused it.
 *
 * Bashar, 2026-09-04: «تم نسخ الرابط should appear with a nice animation above the button».
 *
 * ## Why above, and why absolutely positioned
 *
 * It sat underneath as an ordinary block, so it PUSHED the page: everything below the button moved
 * down when the message arrived and back up when it went, twice per press. Above and out of flow,
 * it costs the layout nothing and it lands where the eye already is — on the control that was just
 * pressed, not below it where the next section starts.
 *
 * ## The animation
 *
 * It rises 6px and fades, on the project's one ease-out, 180ms. Two decisions inside that:
 *
 * - **It moves the way it is going.** Rising on entry and falling on exit is the same gesture
 *   reversed, so an interrupted one reads as a change of mind rather than as a glitch. These are
 *   CSS transitions, not keyframes, precisely so an interruption retargets instead of restarting.
 * - **It never scales from nothing.** Nothing in the world appears from a point; it comes from
 *   slightly below itself, already the right size.
 *
 * `transition-[opacity,transform,translate]` names `translate` because Tailwind v4 emits
 * `translate-y-*` as the standalone CSS `translate` property, not as a `transform` — a list naming
 * only `transform` animates the opacity and teleports the position, which is the bug the phone
 * menu shipped with for one build.
 *
 * `motion-reduce` drops both the movement and the wait: somebody who asked for no animation wants
 * the result, and 180ms of nothing is worse than the animation they turned off.
 *
 * ## It is announced, not just drawn
 *
 * `role="status"` for a confirmation — it is information, and an alert would interrupt whatever a
 * screen reader was mid-sentence on. `role="alert"` for a failure, because that one means the
 * reader has to do something else instead.
 */
export function ButtonToast({ message }: { readonly message: ToastMessage | null }) {
  /* The message stays mounted through its exit; `shown` drives the transition. */
  const [held, setHeld] = useState<ToastMessage | null>(null);
  const [shown, setShown] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  useEffect(() => {
    clear();

    if (!message) {
      setShown(false);

      return;
    }

    setHeld(message);

    /*
      One frame between mounting and moving. The element has to be PAINTED in its from-state before
      the class that moves it is applied, or the browser has nothing to transition from and the
      message simply appears.
    */
    const frame = requestAnimationFrame(() => setShown(true));

    timers.current.push(
      window.setTimeout(() => setShown(false), HOLD_MS),
      window.setTimeout(() => setHeld(null), HOLD_MS + LEAVE_MS),
    );

    return () => {
      cancelAnimationFrame(frame);
      clear();
    };
  }, [message]);

  useEffect(() => clear, []);

  if (!held) return null;

  return (
    <div
      role={held.tone === 'bad' ? 'alert' : 'status'}
      /*
        `bottom-full` puts it above the button and `mb-2` clears it. `start-0` rather than a centred
        `left-1/2 -translate-x-1/2`: that centring would put a transform on the same axis the
        animation uses, and the two would fight. Aligning to the control's own start edge needs no
        transform at all, and mirrors itself between Arabic and German for free.
      */
      className={`pointer-events-none absolute bottom-full start-0 z-10 mb-2 max-w-[min(20rem,78vw)] rounded-lg px-3 py-1.5 text-xs font-semibold shadow-[0_6px_16px_-6px_rgba(15,18,32,0.45)] transition-[opacity,transform,translate] duration-200 ease-out-strong motion-reduce:transition-none ${
        held.tone === 'bad' ? 'bg-bad text-white' : 'bg-text text-bg'
      } ${shown ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'}`}
    >
      {held.text}
    </div>
  );
}
