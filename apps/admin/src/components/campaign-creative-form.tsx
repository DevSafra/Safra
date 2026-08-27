'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { t, apiErrorOf } from '@/lib/strings';

/** How often, and how many times, an open dialog asks whether the render has finished. */
const POLL_EVERY_MS = 2_000;
const POLL_ATTEMPTS = 20;

/**
 * Editing what a live campaign SAYS and SHOWS — in a dialog over the table.
 *
 * ## Why a dialog and not a panel in the cell
 *
 * الحالة is about 150px wide, and four labelled inputs plus an image control cannot be typed into
 * there. Two shapes were tried and neither works inside a table: a panel spanning the cell is still
 * 150px, and an absolutely positioned popover is CLIPPED — the table lives in an `overflow-x-auto`
 * box, which it must so a wide table scrolls inside itself rather than pushing the page sideways,
 * and `overflow: auto` clips absolutely positioned descendants. Measured: 163px rendered against
 * 304px asked for.
 *
 * A fixed-position dialog is outside that box by construction. Bashar asked for exactly this shape
 * on 2026-08-27, and it is the one `photo-gallery.tsx` already uses — backdrop closes, Escape
 * closes, the page behind does not scroll.
 *
 * ## A campaign's WINDOW and PRICE are still not editable
 *
 * There is no form for either, and that is deliberate rather than unfinished: both are what the
 * invoices were issued against, and a campaign whose billing period moves underneath its own
 * invoices is a bill nobody can reconcile. The API's schema knows only these four fields plus the
 * image, so this is not a rule the dialog is keeping on its own.
 */
export function CampaignCreativeForm({
  reference,
  headlineAr,
  headlineEn,
  headlineDe,
  targetUrl,
  imageUrl,
  imageStatus,
}: {
  readonly reference: string;
  readonly headlineAr: string;
  readonly headlineEn: string;
  readonly headlineDe: string;
  readonly targetUrl: string;
  readonly imageUrl: string | null;
  readonly imageStatus: string | null;
}) {
  const router = useRouter();
  const c = t.sections.ads;

  const [open, setOpen] = useState(false);
  const [ar, setAr] = useState(headlineAr);
  const [en, setEn] = useState(headlineEn);
  const [de, setDe] = useState(headlineDe);
  const [target, setTarget] = useState(targetUrl);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Set when the poll below has given up, so the tile stops claiming to be working. */
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trigger = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);

  /*
    Escape closes, the page behind does not scroll, and focus comes back to the button that opened
    it. The last one is the part a `fixed` overlay does not give you: without it a keyboard reader
    is returned to the top of the document, having lost the row they were working on.
  */
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', onKey);

    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      trigger.current?.focus();
    };
  }, [open]);

  /*
    While the dialog is open and a render is in flight, ask again.

    The upload returns the moment the bytes are parked — the variants are written by a WORKER, so
    the row says `processing` and the tile is a placeholder. One `router.refresh()` at upload time
    therefore always re-reads a row that is still processing, and the placeholder stayed there until
    somebody reloaded the page by hand: the operator uploads a picture and never sees it.

    Bounded rather than open-ended. Twenty attempts at two seconds is forty — comfortably past the
    render, and short enough that a job which died leaves a dialog that has stopped asking rather
    than one polling for ever. The status is then `failed`, which the tile says, or still
    `processing`, which `safra_images_processing_stuck` alerts on.
  */
  useEffect(() => {
    if (!open || imageStatus !== 'processing') return undefined;

    let attempts = 0;

    setSlow(false);

    const timer = setInterval(() => {
      attempts += 1;

      if (attempts > POLL_ATTEMPTS) {
        clearInterval(timer);
        /*
          It has stopped asking, and it SAYS so.

          Leaving «جارٍ المعالجة…» on screen after the polling ends is a spinner describing a state
          nobody is observing any more. That is how the job-id bug presented — «it keeps loading and
          nothing happens» — with no way to tell a slow render from a job that was never queued.
        */
        setSlow(true);

        return;
      }

      router.refresh();
    }, POLL_EVERY_MS);

    return () => clearInterval(timer);
  }, [open, imageStatus, router]);

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
        setError(apiErrorOf(await response.json().catch(() => null)));

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

  /**
   * Sends one image through the platform's shared pipeline.
   *
   * The file never becomes a data URL and is never previewed from the client's own bytes: what the
   * tile shows after this is what the SERVER re-encoded, which is the only version anybody is ever
   * served. `router.refresh()` re-reads the row, so the status the operator sees is the row's.
   */
  async function send(chosen: File): Promise<void> {
    setUploading(true);
    setError(null);

    try {
      const body = new FormData();

      body.append('file', chosen);

      const response = await fetch(
        `/api/ad-campaigns/${encodeURIComponent(reference)}/creative`,
        { method: 'POST', body },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      /* A fresh upload starts the wait over — see the poll above. */
      setSlow(false);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  }

  const field =
    'w-full min-w-0 rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text';
  const labelled = 'grid gap-1.5 text-[11.5px] font-semibold text-muted';

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold"
      >
        {c.editCreative}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={c.editTitle}
          /* The backdrop closes, which is what everybody tries first. */
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
        >
          <div
            /* Clicks inside the dialog must not reach the backdrop's handler. */
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xl rounded-[14px] border border-line bg-card p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-[15px] font-bold text-text">{c.editTitle}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={c.close}
                className="grid size-8 cursor-pointer place-items-center rounded-lg border border-line text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="grid gap-3.5">
              <label className={labelled}>
                {c.fHeadlineAr}
                <input
                  value={ar}
                  onChange={(event) => setAr(event.target.value)}
                  className={field}
                />
              </label>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className={labelled}>
                  {c.fHeadlineEn}
                  <input
                    value={en}
                    onChange={(event) => setEn(event.target.value)}
                    className={`field-ltr ${field}`}
                  />
                </label>
                <label className={labelled}>
                  {c.fHeadlineDe}
                  <input
                    value={de}
                    onChange={(event) => setDe(event.target.value)}
                    className={`field-ltr ${field}`}
                  />
                </label>
              </div>

              <label className={labelled}>
                {c.fTargetUrl}
                {/* `field-ltr`: a URL is read left-to-right whatever the page direction. */}
                <input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className={`field-ltr ${field}`}
                />
              </label>

              {/* ── The creative ───────────────────────────────────────────── */}
              <div className={labelled}>
                {c.image}

                <div className="flex flex-wrap items-center gap-3">
                  {imageUrl && imageStatus === 'ready' ? (
                    /*
                      The SERVER's re-encode, not the bytes that were chosen. Nothing the client
                      uploaded is ever displayed, for the same reason nothing it uploaded is ever
                      served.
                    */
                    <img
                      src={imageUrl}
                      alt=""
                      className="h-20 w-32 rounded-lg border border-line object-cover"
                    />
                  ) : (
                    <span className="grid h-20 w-32 place-items-center rounded-lg border border-dashed border-line px-2 text-center text-[10.5px] text-faint">
                      {imageStatus === 'processing'
                        ? slow
                          ? c.imageSlow
                          : c.imageProcessing
                        : imageStatus === 'failed'
                          ? c.imageFailed
                          : c.imageNone}
                    </span>
                  )}

                  <div className="grid gap-1.5">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => file.current?.click()}
                      className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-[9px] border border-line px-4 py-2 text-[12px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold disabled:opacity-50 lg:min-h-0"
                    >
                      {uploading
                        ? c.imageUploading
                        : imageUrl
                          ? c.imageReplace
                          : c.imageChoose}
                    </button>
                    <span className="text-[10.5px] font-normal text-faint">
                      {c.imageHint}
                    </span>
                  </div>

                  {/*
                    `accept` is a COURTESY, not the control. The server refuses anything whose magic
                    bytes are not a supported photograph, before a byte reaches storage.
                  */}
                  <input
                    ref={file}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];

                      if (chosen) void send(chosen);
                    }}
                  />
                </div>
              </div>

              {error ? (
                <p className="text-[11.5px] font-semibold text-bad">{error}</p>
              ) : null}

              <div className="mt-1 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4.5 py-2 text-xs font-bold text-muted lg:min-h-0"
                >
                  {c.cancel}
                </button>
                {/*
                  Disabled until something is DIFFERENT, not merely valid — a PATCH with an empty
                  body would still write an audit row saying the campaign was edited, which is a
                  record of an event that did not happen. The IMAGE saves on choosing, so it is not
                  gated by this.
                */}
                <button
                  type="button"
                  disabled={!ready || !changed}
                  onClick={() => void submit()}
                  className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold transition-colors disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
                >
                  {busy ? c.pausing : c.saveCreative}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
