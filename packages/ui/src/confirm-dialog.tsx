'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

import { Modal } from './modal.js';

/** What a popup asks, and the words it asks with. All of them the caller's own. */
export interface ConfirmRequest {
  /** «حذف الدليل» — what this is about, in three or four words. */
  readonly title: string;
  /** The consequence, in a sentence. This is the part a reader decides on. */
  readonly message: string;
  readonly confirmLabel: string;
  /**
   * Omitted for a NOTICE — a popup with one button, which tells rather than asks.
   *
   * `ask()` then resolves `true` when it is dismissed, because there was nothing to decline.
   */
  readonly cancelLabel?: string | undefined;
  /**
   * `danger` for anything that destroys or cannot be undone.
   *
   * It paints the confirm red AND puts the initial focus on «إلغاء», so a reader who hits Enter
   * out of habit cancels rather than deletes. The colour is the visible half of that; the focus
   * is the half that actually protects somebody.
   */
  readonly tone?: 'default' | 'danger' | undefined;
}

/**
 * The system's popup — «هل أنت متأكد؟», designed rather than borrowed from the browser.
 *
 * ## What it replaces
 *
 * `window.confirm`. Bashar screenshotted one on 2026-08-30: a grey box saying **localhost:3001**,
 * the Arabic question, and two buttons reading **Cancel** and **OK**. Three things wrong with it
 * at once — it shows the reader the ORIGIN, which is chrome no operator should ever meet; its
 * buttons are English and cannot be translated, which is the one thing `docs/i18n.md` exists to
 * prevent; and it looks like nothing else in the console. There were five of them across the
 * console and the partner portal.
 *
 * It is also modal in a way React cannot see: `confirm()` blocks the main thread, so nothing can
 * render underneath it and no state can settle while it is open.
 *
 * ## Promise-based, so the call sites keep their shape
 *
 * A declarative dialog would make every one of those five sites hold pending state and split one
 * function into two. `useConfirm` returns an `ask()` that resolves, so `if (!confirm(...)) return;`
 * becomes `if (!(await ask({...}))) return;` and the flow around it is unchanged.
 *
 * ## Every word comes from the caller
 *
 * Required props, never defaulted — the reason `PasswordField` gives: a default here would be a
 * string living in a shared package, invisible to the task of adding a language, and «OK» in a
 * shared package is exactly the bug this replaces.
 */
export function ConfirmDialog({
  request,
  onResolve,
}: {
  /** `null` when nothing is being asked — the dialog renders nothing at all. */
  readonly request: ConfirmRequest | null;
  readonly onResolve: (confirmed: boolean) => void;
}) {
  /*
    Declared before the early return: hooks may not sit behind a condition. It is the button that
    must hold the focus when the popup opens — «إلغاء» for a destructive question, the confirm
    otherwise — and `Modal` focuses whatever this points at.
  */
  const initial = useRef<HTMLButtonElement>(null);

  if (!request) return null;

  const danger = request.tone === 'danger';
  const asks = request.cancelLabel !== undefined;

  return (
    /*
      `alertdialog`, not `dialog`: this interrupts to ask something that cannot wait, and a screen
      reader announces its description immediately rather than only on focus.

      Everything about Escape, the backdrop, the focus trap, scroll-locking and returning focus is
      `Modal`'s — written once, so a form modal and a confirmation cannot drift apart on the half
      that is easy to get wrong.
    */
    <Modal
      title={request.title}
      role="alertdialog"
      labelledBy="safra-confirm-title"
      describedBy="safra-confirm-message"
      width="max-w-md"
      initialFocus={initial}
      onClose={() => onResolve(false)}
    >
      <h2 id="safra-confirm-title" className="text-[15px] font-bold text-text">
        {request.title}
      </h2>

      <p id="safra-confirm-message" className="text-[12.5px] leading-relaxed text-text2">
        {request.message}
      </p>

      {/*
          The confirm sits at the END of the row and the cancel before it, so the destructive
          button is never the one under a thumb reaching for the edge of a phone.
        */}
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
        {asks ? (
          <button
            type="button"
            /*
              The CANCEL of a destructive question holds the focus, so somebody pressing Enter out
              of habit cancels rather than deletes. Handed to `Modal` as `initialFocus` rather than
              set with `autoFocus`: a child's effect runs before its parent's, so `autoFocus` was
              overridden by the frame focus a moment later.
            */
            ref={danger ? initial : undefined}
            onClick={() => onResolve(false)}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-xs font-bold text-muted transition-colors hover:text-text lg:min-h-0"
          >
            {request.cancelLabel}
          </button>
        ) : null}

        <button
          type="button"
          ref={danger && asks ? undefined : initial}
          onClick={() => onResolve(true)}
          className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg px-4.5 py-2 text-xs font-bold transition-opacity hover:opacity-90 lg:min-h-0 ${
            danger ? 'bg-bad text-white' : 'bg-gold text-ink'
          }`}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The popup, as something a handler can `await`.
 *
 * ```tsx
 * const { ask, dialog } = useConfirm();
 * …
 * if (!(await ask({ title, message, confirmLabel, cancelLabel, tone: 'danger' }))) return;
 * …
 * return <>{…}{dialog}</>;
 * ```
 *
 * The resolver is held in a ref rather than in state: it is not rendered, and putting it in state
 * would re-render the caller twice for every question.
 */
export function useConfirm(): {
  ask: (request: ConfirmRequest) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const ask = useCallback(
    (next: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        /*
          A second question while one is open answers the first as declined rather than dropping
          its promise — an awaited call that never settles leaves the handler that made it stuck
          with `busy` set for ever.
        */
        resolver.current?.(false);
        resolver.current = resolve;
        setRequest(next);
      }),
    [],
  );

  const onResolve = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;

    resolver.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  return {
    ask,
    dialog: <ConfirmDialog request={request} onResolve={onResolve} />,
  };
}
