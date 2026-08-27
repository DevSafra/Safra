'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * Editing what a live campaign SAYS, from the row it says it on.
 *
 * ## Why the creative is editable and nothing else is
 *
 * A typo in a headline is visible to every customer in the city until somebody fixes it, and the
 * only alternative was to end the campaign and issue a new one — which re-bills the advertiser for
 * a window they had already paid for. The WINDOW and the PRICE stay fixed for the same reason
 * inverted: they are what the invoices were issued against, and a campaign whose billing period
 * moves underneath its own invoices is a bill nobody can reconcile. The API's schema knows only
 * these four fields, so this is not a rule the form is keeping.
 *
 * ## It opens in the row, not in a panel
 *
 * `PATCH /admin/ad-campaigns/:reference` had no caller at all until this existed — the same
 * «built and connected to nothing» shape that the whole domain had a day earlier, reproduced one
 * level down. Found by asking, of my own work, which endpoints a person can actually reach.
 */
export function CampaignCreativeForm({
  reference,
  headlineAr,
  headlineEn,
  headlineDe,
  targetUrl,
}: {
  readonly reference: string;
  readonly headlineAr: string;
  readonly headlineEn: string;
  readonly headlineDe: string;
  readonly targetUrl: string;
}) {
  const router = useRouter();
  const c = t.sections.ads;

  const [open, setOpen] = useState(false);
  const [ar, setAr] = useState(headlineAr);
  const [en, setEn] = useState(headlineEn);
  const [de, setDe] = useState(headlineDe);
  const [target, setTarget] = useState(targetUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Shape only; every rule is re-checked by the schema, which is the guard. */
  const ready =
    ar.trim().length >= 2 &&
    en.trim().length >= 2 &&
    de.trim().length >= 2 &&
    /^https?:\/\/\S+$/.test(target.trim()) &&
    !busy;

  const changed =
    ar !== headlineAr || en !== headlineEn || de !== headlineDe || target !== targetUrl;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/ad-campaigns/${encodeURIComponent(reference)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        /* Only what actually changed — the schema takes each field optionally. */
        body: JSON.stringify({
          ...(ar !== headlineAr ? { headlineAr: ar.trim() } : {}),
          ...(en !== headlineEn ? { headlineEn: en.trim() } : {}),
          ...(de !== headlineDe ? { headlineDe: de.trim() } : {}),
          ...(target !== targetUrl ? { targetUrl: target.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        setError(apiErrorOf(payload));

        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold"
      >
        {c.editCreative}
      </button>
    );
  }

  const field =
    'w-full min-w-0 rounded-md border border-line bg-field px-2 py-1.5 text-[11.5px] text-text';

  /*
    Open, the form takes the WHOLE cell — and the cell is still narrow.

    ## What was tried and does not work

    A popover: `absolute`, anchored under the button at `w-[19rem]`, so the fields would have room.
    It is CLIPPED. The table lives in an `overflow-x-auto` box — which it must, so a wide table
    scrolls inside itself rather than pushing the page sideways — and `overflow: auto` clips
    absolutely positioned descendants. Measured rather than reasoned: the panel rendered 163px wide
    against the 304px asked for, with the rest cut off at the container's edge. Escaping that needs
    `position: fixed` and JavaScript to keep the panel with the button, which is a lot of machinery
    for four text inputs.

    ## What this is instead

    `col-span-2`, so the form uses the full width of الحالة rather than half of it now that the
    controls are a pair of equal tracks. That is the best shape available inside a table cell, and
    it is still cramped: the URL label wraps and its value scrolls inside the box.

    **The right answer is to open this in the panel under the toolbar**, at the table's full width,
    where the CREATE form already lives — reached from the row by a `?edit=<reference>` parameter so
    it stays server-driven and shareable. That is a change to the screen's shape rather than to this
    cell, and it is Bashar's to approve.
  */
  return (
    <div className="col-span-2 grid gap-1.5">
      {/* The label carries the language: four boxes with no names is four guesses. */}
      <label className="grid gap-0.5 text-[10px] text-faint">
        {c.fHeadlineAr}
        <input value={ar} onChange={(e) => setAr(e.target.value)} className={field} />
      </label>
      <label className="grid gap-0.5 text-[10px] text-faint">
        {c.fHeadlineEn}
        <input
          value={en}
          onChange={(e) => setEn(e.target.value)}
          className={`field-ltr ${field}`}
        />
      </label>
      <label className="grid gap-0.5 text-[10px] text-faint">
        {c.fHeadlineDe}
        <input
          value={de}
          onChange={(e) => setDe(e.target.value)}
          className={`field-ltr ${field}`}
        />
      </label>
      <label className="grid gap-0.5 text-[10px] text-faint">
        {c.fTargetUrl}
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={`field-ltr ${field}`}
        />
      </label>

      {error ? <span className="text-[10px] font-semibold text-bad">{error}</span> : null}

      <div className="flex flex-wrap gap-1.5">
        {/*
          Disabled until something is DIFFERENT, not merely valid.

          «A submit that changes nothing does nothing» — a PATCH with an empty body would still
          write an audit row saying the campaign was edited, which is a record of an event that
          did not happen.
        */}
        <button
          type="button"
          disabled={!ready || !changed}
          onClick={() => void submit()}
          className="cursor-pointer rounded-md border border-[rgba(var(--goldA),0.4)] px-2.5 py-0.5 text-[10.5px] font-bold text-gold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? c.pausing : c.saveCreative}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setAr(headlineAr);
            setEn(headlineEn);
            setDe(headlineDe);
            setTarget(targetUrl);
          }}
          className="cursor-pointer rounded-md border border-line px-2.5 py-0.5 text-[10.5px] text-muted"
        >
          {c.cancel}
        </button>
      </div>
    </div>
  );
}
