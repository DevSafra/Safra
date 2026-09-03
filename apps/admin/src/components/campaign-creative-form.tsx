'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ImageSliderFrame } from '@safra/ui';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * The change waiting for حفظ — a new picture, or the removal of the one that is there.
 *
 * One value rather than a `File | null` beside a `removing` boolean, because those two can
 * contradict each other and this cannot: choosing a picture and removing it are alternatives, and
 * the type is what says so.
 */
type Staged =
  | { readonly kind: 'none' }
  | { readonly kind: 'replace'; readonly file: File }
  | { readonly kind: 'remove' };

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
  descriptionAr,
  descriptionEn,
  descriptionDe,
  targetUrl,
  imageUrl,
  imageStatus,
  autoOpen,
}: {
  readonly reference: string;
  readonly headlineAr: string;
  readonly headlineEn: string;
  readonly headlineDe: string;
  /** Null where the campaign has none — see `campaignUpdateSchema`. */
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  readonly descriptionDe: string | null;
  readonly targetUrl: string;
  readonly imageUrl: string | null;
  readonly imageStatus: string | null;
  /*
    Opened by the page, because the operator has JUST created this campaign.

    Decided on the SERVER, from that page's own `searchParams`, rather than read here with
    `useSearchParams` — the comparison is `created === row.reference`, an equality test against a
    value this screen already holds, so a crafted `?created=` can only ever open a dialog on a row
    the reader is already looking at.
  */
  readonly autoOpen: boolean;
}) {
  const router = useRouter();
  const c = t.sections.ads;

  const [open, setOpen] = useState(autoOpen);
  const [ar, setAr] = useState(headlineAr);
  const [en, setEn] = useState(headlineEn);
  const [de, setDe] = useState(headlineDe);
  /* Null is «no description»; the box shows it as empty and sends it back as null. */
  const [descAr, setDescAr] = useState(descriptionAr ?? '');
  const [descEn, setDescEn] = useState(descriptionEn ?? '');
  const [descDe, setDescDe] = useState(descriptionDe ?? '');
  const [target, setTarget] = useState(targetUrl);
  const [busy, setBusy] = useState(false);
  /*
    The file WAITING to be sent — the whole of «Save should commit, Cancel should discard».

    It used to upload the instant it was chosen, which broke this dialog's own contract in both
    directions: حفظ stayed disabled when the picture was the only thing changed, and إلغاء could
    not undo the one change that had already been committed. Nothing leaves the browser now until
    حفظ is pressed.
  */
  const [staged, setStaged] = useState<Staged>({ kind: 'none' });
  /** Set when the poll below has given up, so the tile stops claiming to be working. */
  const [slow, setSlow] = useState(false);
  /* 0 when the creative is open at full size, null when it is not — the one previewer. */
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);

  /**
   * Opens on the row as it stands NOW — which is what makes إلغاء a real cancel.
   *
   * A headline typed, abandoned and found still typed on reopening would be the same lie the
   * staged file used to tell: the dialog showing an edit that is not saved anywhere.
   */
  function reopen(): void {
    setAr(headlineAr);
    setEn(headlineEn);
    setDe(headlineDe);
    setDescAr(descriptionAr ?? '');
    setDescEn(descriptionEn ?? '');
    setDescDe(descriptionDe ?? '');
    setTarget(targetUrl);
    setStaged({ kind: 'none' });
    setError(null);
    setSlow(false);
    setOpen(true);
  }

  /*
    Escape closes, the page behind does not scroll, and focus comes back to the button that opened
    it. The last one is the part a `fixed` overlay does not give you: without it a keyboard reader
    is returned to the top of the document, having lost the row they were working on.
  */
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
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

  /*
    Something is DIFFERENT — including a picture that has been chosen and not yet sent.

    Bashar, 2026-08-27: «when I change only the image, I should be able to save». Leaving the file
    out of this was what disabled حفظ on the one change an operator makes most often.
  */
  const changed =
    ar !== headlineAr ||
    en !== headlineEn ||
    de !== headlineDe ||
    descAr !== (descriptionAr ?? '') ||
    descEn !== (descriptionEn ?? '') ||
    descDe !== (descriptionDe ?? '') ||
    target !== targetUrl ||
    staged.kind !== 'none';

  /**
   * Closes, throwing away the file that was never sent.
   *
   * The TEXT is reverted by `reopen` rather than here, and the difference matters: this function
   * is called from an effect that runs only when `open` changes, so anything it read from props
   * would be whatever those props were when the dialog opened. After a save the row refreshes
   * underneath it, and resetting from that stale copy would put the OLD headline back on a field
   * the operator had just saved. Reverting on the way IN reads today's row every time.
   */
  function dismiss(): void {
    setOpen(false);
    setStaged({ kind: 'none' });
    setError(null);

    /*
      And the `?created=` that opened it is dropped, so a reload does not reopen a dialog the
      operator has closed. `history.replaceState` rather than a router navigation: there is nothing
      to re-fetch, and the path comes from `location`, never from the parameter being removed.
    */
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);

    if (!url.searchParams.has('created')) return;

    url.searchParams.delete('created');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  /**
   * One save, committing whatever is different — the text, the picture, or both.
   *
   * ## The order, and what a half-failure leaves behind
   *
   * The PATCH first, because it is validated in milliseconds and the upload STARTS A RENDER: a save
   * that is going to be refused for a headline should not have queued a worker job first. They are
   * two resources and there is no transaction across them, so a failure on the second leaves the
   * first saved — the dialog stays open, says which one refused, and the operator presses حفظ
   * again. That is the honest outcome; pretending otherwise would need a staging area for bytes,
   * which is a second storage path and a second place for the pipeline's guarantees to be missed.
   */
  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      /* Only what actually changed — the schema takes each field optionally. */
      const text = {
        ...(ar !== headlineAr ? { headlineAr: ar.trim() } : {}),
        ...(en !== headlineEn ? { headlineEn: en.trim() } : {}),
        ...(de !== headlineDe ? { headlineDe: de.trim() } : {}),
        /*
          An emptied box sends `null`, not `''`.

          The schema is `.nullable().optional()`: omitted leaves the description alone, null clears
          it, and `''` would be two characters short of the minimum and refused. Without the null
          an operator could add a description and never take one off.
        */
        ...(descAr !== (descriptionAr ?? '')
          ? { descriptionAr: descAr.trim() === '' ? null : descAr.trim() }
          : {}),
        ...(descEn !== (descriptionEn ?? '')
          ? { descriptionEn: descEn.trim() === '' ? null : descEn.trim() }
          : {}),
        ...(descDe !== (descriptionDe ?? '')
          ? { descriptionDe: descDe.trim() === '' ? null : descDe.trim() }
          : {}),
        ...(target !== targetUrl ? { targetUrl: target.trim() } : {}),
      };

      /*
        Skipped entirely when the picture is the only change. An empty PATCH would still write an
        audit row saying the campaign was edited, which is a record of an event that did not happen.
      */
      if (Object.keys(text).length > 0) {
        const response = await fetch(
          `/api/ad-campaigns/${encodeURIComponent(reference)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(text),
          },
        );

        if (!response.ok) {
          setError(apiErrorOf(await response.json().catch(() => null)));

          return;
        }

        /* What the server was actually given, so a trailing space does not read as unsaved. */
        setAr(ar.trim());
        setEn(en.trim());
        setDe(de.trim());
        setDescAr(descAr.trim());
        setDescEn(descEn.trim());
        setDescDe(descDe.trim());
        setTarget(target.trim());
      }

      if (staged.kind === 'remove') {
        const response = await fetch(
          `/api/ad-campaigns/${encodeURIComponent(reference)}/creative`,
          { method: 'DELETE' },
        );

        if (!response.ok) {
          setError(apiErrorOf(await response.json().catch(() => null)));

          return;
        }

        /*
          Closed, unlike a replacement: nothing is being rendered and there is nothing to wait
          for. The row picks up «بلا صورة», which is the confirmation.
        */
        setStaged({ kind: 'none' });
        router.refresh();
        dismiss();

        return;
      }

      if (staged.kind === 'replace') {
        const body = new FormData();

        body.append('file', staged.file);

        const response = await fetch(
          `/api/ad-campaigns/${encodeURIComponent(reference)}/creative`,
          { method: 'POST', body },
        );

        if (!response.ok) {
          setError(apiErrorOf(await response.json().catch(() => null)));

          return;
        }

        setStaged({ kind: 'none' });
        /* A fresh upload starts the wait over — see the poll above. */
        setSlow(false);
        router.refresh();

        /*
          And the dialog STAYS OPEN.

          This is the only place in the console the creative is visible — the row shows whether one
          exists, never the picture itself. Closing here would send the operator away at the exact
          moment the render begins, with no way to see the result but to reopen. Instead the row
          comes back `processing`, the poll above takes over, and the tile becomes the image the
          SERVER re-encoded. حفظ is disabled again because nothing is different any more, and the
          left button now reads «إغلاق» rather than «إلغاء».
        */
        return;
      }

      router.refresh();
      dismiss();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full min-w-0 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text';
  const labelled = 'grid gap-1.5 text-[11.5px] font-semibold text-muted';

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => reopen()}
        className="inline-flex w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold"
      >
        {c.editCreative}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={c.editTitle}
          /* The backdrop closes, which is what everybody tries first. */
          onClick={() => dismiss()}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
        >
          <div
            /* Clicks inside the dialog must not reach the backdrop's handler. */
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xl rounded-card border border-line bg-card p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-[15px] font-bold text-text">{c.editTitle}</h2>
              <button
                type="button"
                onClick={() => dismiss()}
                aria-label={c.closeDialog}
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

              {/*
                The descriptions (Bashar, 2026-08-31). Emptying one CLEARS it — see `submit` — so
                the three boxes are the whole control: there is no separate «remove description».
              */}
              <div className="grid gap-3">
                <label className={labelled}>
                  {c.fDescriptionAr}
                  <textarea
                    value={descAr}
                    onChange={(event) => setDescAr(event.target.value)}
                    rows={2}
                    className={field}
                  />
                </label>
                <label className={labelled}>
                  {c.fDescriptionEn}
                  <textarea
                    value={descEn}
                    onChange={(event) => setDescEn(event.target.value)}
                    rows={2}
                    className={`field-ltr ${field}`}
                  />
                </label>
                <label className={labelled}>
                  {c.fDescriptionDe}
                  <textarea
                    value={descDe}
                    onChange={(event) => setDescDe(event.target.value)}
                    rows={2}
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
                  {staged.kind === 'remove' ? (
                    /* What حفظ is about to do, said before it is done. */
                    <span className="grid h-20 w-32 content-center gap-1 rounded-lg border border-dashed border-line px-2 text-center text-[10.5px] text-muted">
                      <span>{c.imageNone}</span>
                      <span className="font-normal text-faint">
                        {c.imageRemoveStaged}
                      </span>
                    </span>
                  ) : staged.kind === 'replace' ? (
                    /*
                      Chosen, not sent — and it says so.

                      The file's NAME, never a preview drawn from its bytes. `URL.createObjectURL`
                      would show the operator their own picture and then swap it for a different
                      one after the render, which teaches that the thing on screen is what will be
                      served. It is not: what gets served is the SERVER's re-encode, and this tile
                      shows only that.
                    */
                    <span className="grid h-20 w-32 content-center gap-1 rounded-lg border border-dashed border-[rgba(var(--goldA),0.55)] px-2 text-center text-[10.5px] text-gold">
                      <span className="w-full truncate" title={staged.file.name}>
                        {staged.file.name}
                      </span>
                      <span className="font-normal text-faint">{c.imageStaged}</span>
                    </span>
                  ) : imageUrl && imageStatus === 'ready' ? (
                    /*
                      The SERVER's re-encode, not the bytes that were chosen. Nothing the client
                      uploaded is ever displayed, for the same reason nothing it uploaded is ever
                      served.
                    */
                    /*
                      The thumbnail OPENS at full size, through the one previewer (project rule,
                      2026-08-30). A creative is approved or rejected on how it looks, and this
                      showed it at 128×80 with no way to see more.
                    */
                    <button
                      type="button"
                      onClick={() => setPreview(0)}
                      aria-label={t.sections.slider.open}
                      className="block cursor-pointer"
                    >
                      <img
                        src={imageUrl}
                        alt=""
                        className="h-20 w-32 rounded-lg border border-line object-cover"
                      />
                    </button>
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
                      disabled={busy}
                      onClick={() => file.current?.click()}
                      className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-[12px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold disabled:opacity-50 lg:min-h-0"
                    >
                      {imageUrl || staged.kind === 'replace'
                        ? c.imageReplace
                        : c.imageChoose}
                    </button>

                    {/*
                      Taking the picture OFF, offered only where there is one to take off — and
                      not while a replacement is staged, because choosing a file and removing it
                      are alternatives rather than a sequence.
                    */}
                    {imageStatus !== null && staged.kind === 'none' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setStaged({ kind: 'remove' })}
                        className="w-fit cursor-pointer text-[10.5px] font-normal text-muted underline transition-colors hover:text-bad disabled:opacity-50"
                      >
                        {c.imageRemove}
                      </button>
                    ) : null}

                    {/* Putting a staged change back, without closing everything else down. */}
                    {staged.kind === 'none' ? (
                      <span className="text-[10.5px] font-normal text-faint">
                        {c.imageHint}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setStaged({ kind: 'none' })}
                        className="w-fit cursor-pointer text-[10.5px] font-normal text-muted underline transition-colors hover:text-gold disabled:opacity-50"
                      >
                        {staged.kind === 'remove'
                          ? c.imageRemoveUndo
                          : c.imageStagedDiscard}
                      </button>
                    )}
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

                      if (chosen) {
                        setStaged({ kind: 'replace', file: chosen });
                        setError(null);
                      }

                      /*
                        Cleared, so choosing the SAME file again after discarding it still fires
                        `change` — a file input whose value is unchanged is silent.
                      */
                      event.target.value = '';
                    }}
                  />
                </div>
              </div>

              {error ? (
                <p className="text-[11.5px] font-semibold text-bad">{error}</p>
              ) : null}

              <div className="mt-1 flex flex-wrap justify-end gap-2">
                {/*
                  «إلغاء» while there is something to discard, «إغلاق» once there is not.

                  After a save the dialog stays open to show the render, and a button still
                  offering to CANCEL at that point describes an undo this screen cannot perform.
                */}
                <button
                  type="button"
                  onClick={() => dismiss()}
                  className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4.5 py-2 text-xs font-bold text-muted lg:min-h-0"
                >
                  {changed ? c.cancel : c.close}
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

      {/* The one previewer — see the project rule. `imageUrl` is null until the worker has run. */}
      <ImageSliderFrame
        images={imageUrl ? [{ id: 'creative', thumb: imageUrl, full: imageUrl }] : []}
        at={preview}
        onChange={setPreview}
        labels={t.sections.slider}
      />
    </>
  );
}
