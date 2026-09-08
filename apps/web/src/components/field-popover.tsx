'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A search-bar segment that opens a panel — the shell behind both booking.com-style controls.
 *
 * One implementation, because the dates field and the occupancy field differ only in what is
 * inside the panel. Two copies of "open, trap nothing, close on Escape, close on an outside press,
 * stay inside the viewport" is how one of them ends up closing on Escape and the other not.
 *
 * ## Not a `useConfirm()` dialog
 *
 * `.claude/CLAUDE.md` requires every POPUP to be `useConfirm()` from `@safra/ui`, and this is
 * deliberately not one. That rule is about a modal that ASKS something and blocks the page — it
 * replaces `window.confirm`. A search-bar popover is a disclosure attached to its trigger: it does
 * not dim the page, does not trap focus, and dismisses by pressing anywhere else, because a person
 * comparing dates against the results behind it must be able to reach them. Making it modal would
 * be the wrong behaviour, not a stricter one.
 *
 * ## Focus and dismissal
 *
 * Escape closes and returns focus to the trigger, which is what a keyboard user expects and what
 * makes the control reachable without a mouse. An outside `pointerdown` closes it — `pointerdown`
 * rather than `click`, so a press that starts outside and drags in does not leave it open. Focus
 * is NOT trapped: tabbing past the last control inside should leave, since the panel is part of a
 * form the person is still filling in.
 */
export function FieldPopover({
  label,
  value,
  doneLabel,
  icon,
  children,
}: {
  label: string;
  value: string;
  doneLabel: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };

    const onPointer = (event: PointerEvent) => {
      if (wrap.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg bg-field px-3 py-2 text-start transition-[background-color] duration-200 ease-out-strong"
      >
        {icon ? (
          <span aria-hidden className="shrink-0 text-muted">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-muted">{label}</span>
          <span className="block truncate text-[14px] text-text">{value}</span>
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          /*
            `top-full` with a logical `start-0`, so the panel hangs from its own segment and mirrors
            under `dir` without a second rule. `max-w-[calc(100vw-2rem)]` is what keeps it on screen
            when the segment it belongs to sits near the edge of a phone — the panel is wider than
            the field, and without the cap it would push the page sideways, which
            `responsive.spec.ts` fails the whole site for.
          */
          className="absolute top-full start-0 z-30 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-card border border-line bg-card p-4 shadow-lg"
        >
          <div className="flex flex-col gap-3">{children}</div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
              className="btn-gold min-h-10 cursor-pointer lg:min-h-9 rounded-lg px-5 text-[14px] font-bold transition-[opacity] duration-200 ease-out-strong hover:opacity-90"
            >
              {doneLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One `−  n  +` row.
 *
 * The buttons are DISABLED at the bounds rather than clamping silently, because a stepper that
 * accepts a press and does nothing is indistinguishable from one that is broken. `aria-label`
 * names the field it steps — «زيادة البالغون» — since four unlabelled `+` buttons in one panel are
 * four identical announcements to a screen reader.
 */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  increase,
  decrease,
  tone = 'sky',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** A `{field}` template from the catalogue, filled here rather than in twelve call sites. */
  increase: string;
  decrease: string;
  /**
   * Which accent the control wears, because it now appears on two surfaces.
   *
   * The search popover is a neutral panel and sky is its accent; the booking card is gold
   * throughout. A page picks ONE accent and keeps it, so a blue stepper inside the gold summary
   * reads as a control borrowed from somewhere else — which is exactly what it would have been.
   */
  tone?: 'sky' | 'gold';
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-[14px] text-text">{label}</span>
      <span className="flex items-center gap-1">
        <Step
          label={decrease.replace('{field}', label)}
          glyph="−"
          tone={tone}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        />
        {/*
          `tabular-nums` so the row does not shift by a pixel between «1» and «8», and a fixed
          width so it does not shift between one digit and two.

          A DIGIT, in every stepper (Bashar, 2026-09-03). The bedrooms row briefly rendered the
          counted word — «غرفة», «غرفتان» — and it broke the column: four rows that should read as
          one control had three numbers and one phrase, at three different widths.
        */}
        <span className="w-7 text-center text-[14px] font-semibold tabular-nums text-text">
          {value}
        </span>
        <Step
          label={increase.replace('{field}', label)}
          glyph="+"
          tone={tone}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        />
      </span>
    </div>
  );
}

function Step({
  label,
  glyph,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  tone: 'sky' | 'gold';
  disabled: boolean;
  onClick: () => void;
}) {
  /*
    Written as whole class strings rather than assembled from fragments, because Tailwind scans the
    source for literals — a `text-${tone}` produces a class that exists nowhere in the stylesheet
    and the control renders unstyled.
  */
  const accent =
    tone === 'gold'
      ? 'text-gold-read not-disabled:hover:border-[rgba(var(--goldA),0.55)] not-disabled:hover:bg-[rgba(var(--goldA),0.08)]'
      : 'text-sky not-disabled:hover:border-sky';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      /*
        The disabled state was measured, not assumed: it used to come out rgb(62,101,150) against
        an enabled rgb(46,102,168) — two blues nobody could tell apart, so a stepper at its ceiling
        looked exactly like one with room to move. `opacity` on the whole button is what makes the
        difference unmissable, and it cannot be beaten by a colour utility further down the cascade.
      */
      className={`grid size-8 cursor-pointer place-items-center rounded-lg border border-line text-base transition-[border-color,color,background-color,opacity] duration-200 ease-out-strong disabled:cursor-not-allowed disabled:border-line/50 disabled:opacity-35 active:scale-95 ${accent}`}
    >
      {/* A mathematical sign, not a word: no letters, so `no-hardcoded-text` does not apply. */}
      <span aria-hidden>{glyph}</span>
    </button>
  );
}
