'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ImageSliderFrame, type SliderImage } from '@safra/ui';

import { t, apiErrorOf } from '@/lib/strings';

/** How often, and how many times, the card asks whether a photograph has finished rendering. */
const POLL_EVERY_MS = 2_000;
const POLL_ATTEMPTS = 20;

/**
 * The photographs on a dispute — EC-007's, above all — and the control that adds one.
 *
 * ## Why this is on the card
 *
 * «الغرفة لا تطابق الصور المنشورة» is settled by looking at a photograph. The count of them has been
 * on this screen since النزاعات was built and nothing could write a row, so it read zero for every
 * dispute the platform ever had: an operator decided whether to uphold a complaint, release a
 * frozen payout and credit a wallet, from a headline and a number that was always the same.
 *
 * ## What is shown is what the SERVER re-encoded
 *
 * Never the bytes that were chosen. `url` is null until the worker has rendered the file, which is
 * why a placeholder appears first and the picture replaces it — the same contract the ad creative
 * has, and the reason neither ever displays a client's own upload.
 */
export function DisputeEvidence({
  reference,
  closed,
  evidence,
}: {
  readonly reference: string;
  /** A settled dispute takes no more evidence — the API refuses it, and the control is not offered. */
  readonly closed: boolean;
  readonly evidence: readonly {
    readonly id: string;
    readonly rendered: boolean;
    readonly fileName: string;
    readonly byStaff: boolean;
  }[];
}) {
  const router = useRouter();
  const c = t.sections.disputes;

  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /* The photograph being looked at, and the one being replaced — see `send`. */
  const [preview, setPreview] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const pending = evidence.filter((one) => !one.rendered).length;

  /*
    THIS origin, not the object store.

    The bytes are private, so the `disputes/` prefix is not anonymously readable and there is no
    public address to put in a `src`. An image tag cannot send a bearer token but it does send this
    origin's cookie, and the route behind this path exchanges one for the other.
  */
  const fileHref = (id: string): string =>
    `/api/disputes/evidence/${encodeURIComponent(id)}/file`;

  /*
    While something is still being rendered, ask again.

    The upload returns the moment the bytes are parked — the variants are written by a WORKER — so
    one refresh at upload time always re-reads a row that is still unrendered, and the placeholder
    would sit there until somebody reloaded by hand. Bounded rather than open-ended: twenty attempts
    at two seconds is comfortably past the render, and short enough that a job which died leaves a
    card that has stopped asking rather than one polling for ever.
  */
  useEffect(() => {
    if (pending === 0) return undefined;

    let attempts = 0;

    setSlow(false);

    const timer = setInterval(() => {
      attempts += 1;

      if (attempts > POLL_ATTEMPTS) {
        clearInterval(timer);
        setSlow(true);

        return;
      }

      router.refresh();
    }, POLL_EVERY_MS);

    return () => clearInterval(timer);
  }, [pending, router]);

  /**
   * Retires one photograph. Shared by «حذف» and by the second half of «استبدال».
   *
   * Returns whether it worked, so a replace can stop rather than ending with the old picture gone
   * and the new one never sent.
   */
  async function retire(id: string): Promise<boolean> {
    const response = await fetch(`/api/disputes/evidence/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      setError(apiErrorOf(await response.json().catch(() => null)));

      return false;
    }

    return true;
  }

  async function remove(id: string): Promise<void> {
    if (!window.confirm(c.evidenceConfirmRemove)) return;

    setRemoving(id);
    setError(null);

    try {
      if (await retire(id)) router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setRemoving(null);
    }
  }

  /**
   * Sends a file — as a new piece of evidence, or as the second half of a replacement.
   *
   * A replacement is a REMOVAL followed by an upload, two audited events, rather than new bytes
   * under an old id: a row whose bytes changed would make the resolution unreadable against what
   * the decision was actually made from. The order matters — the old one goes first, so a failure
   * to upload leaves a file with one photograph missing rather than two identical ones.
   */
  async function send(chosen: File): Promise<void> {
    const replaced = replacing;

    setBusy(true);
    setError(null);

    try {
      if (replaced !== null && !(await retire(replaced))) return;

      const body = new FormData();

      body.append('file', chosen);

      const response = await fetch(
        `/api/disputes/${encodeURIComponent(reference)}/evidence`,
        { method: 'POST', body },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      setSlow(false);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
      setReplacing(null);
      if (file.current) file.current.value = '';
    }
  }

  /*
    Only what has been RENDERED can be previewed — the worker writes the variants, and a frame over
    a placeholder shows nothing. Built from the list rather than stored, so a refresh cannot leave a
    stale picture on screen.
  */
  const slides: SliderImage[] = evidence
    .filter((one) => one.rendered)
    .map((one) => ({
      id: one.id,
      thumb: fileHref(one.id),
      full: fileHref(one.id),
      caption: one.fileName,
      badge: one.byStaff ? c.evidenceFiledByStaff : c.evidenceFiledByCustomer,
    }));

  if (closed && evidence.length === 0) return null;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-[11px] font-semibold text-faint">{c.evidenceTitle}</p>

      <div className="flex flex-wrap items-center gap-2">
        {evidence.map((one) =>
          !one.rendered ? (
            <span
              key={one.id}
              data-evidence-pending={one.id}
              className="grid h-16 w-20 place-items-center rounded-lg border border-dashed border-line px-1 text-center text-[9.5px] text-faint"
            >
              {slow ? c.evidenceSlow : c.evidenceProcessing}
            </span>
          ) : (
            /*
              A thumbnail that OPENS IN PLACE, and its two controls under it.

              It was an `<a target="_blank">` to the raw file: looking at a photograph meant leaving
              the dispute, and a decision is made by reading the complaint and the picture together
              (Bashar, 2026-08-30). `alt=""` because the picture IS the content — a description
              invented here would be a claim about somebody's room that nobody made.
            */
            <span key={one.id} className="grid gap-1">
              <button
                type="button"
                onClick={() => setPreview(slides.findIndex((s) => s.id === one.id))}
                title={one.fileName}
                aria-label={c.evidenceOpen}
                data-evidence={one.id}
                className="block cursor-pointer"
              >
                <img
                  src={fileHref(one.id)}
                  alt=""
                  loading="lazy"
                  className={`h-16 w-20 rounded-lg border object-cover transition-colors ${
                    one.byStaff
                      ? 'border-[rgba(var(--skyA),0.5)]'
                      : 'border-line hover:border-[rgba(var(--goldA),0.5)]'
                  }`}
                />
              </button>

              {closed ? null : (
                <span className="flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy || removing !== null}
                    data-evidence-replace={one.id}
                    onClick={() => {
                      setReplacing(one.id);
                      file.current?.click();
                    }}
                    className="cursor-pointer text-[10px] text-faint transition-colors hover:text-gold disabled:opacity-50"
                  >
                    {c.evidenceReplace}
                  </button>
                  <button
                    type="button"
                    disabled={busy || removing !== null}
                    data-evidence-remove={one.id}
                    onClick={() => void remove(one.id)}
                    className="cursor-pointer text-[10px] text-faint transition-colors hover:text-bad disabled:opacity-50"
                  >
                    {removing === one.id ? c.evidenceRemoving : c.evidenceRemove}
                  </button>
                </span>
              )}
            </span>
          ),
        )}

        {closed ? null : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => file.current?.click()}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-dashed border-line px-3 py-1.5 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:opacity-50 lg:min-h-0"
            >
              {busy ? c.evidenceUploading : c.evidenceAdd}
            </button>
            {/*
              `accept` is a COURTESY, not the control. The server refuses anything whose magic bytes
              are not a supported photograph, before a byte reaches storage.
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
          </>
        )}
      </div>

      {error ? (
        <p className="mt-1.5 text-[11px] font-semibold text-bad">{error}</p>
      ) : null}

      {/* What «حذف» actually does, said before it is pressed rather than after. */}
      {closed || evidence.length === 0 ? null : (
        <p className="mt-1.5 text-[10.5px] text-faint2">{c.evidenceRemoveNote}</p>
      )}

      {/*
        The SHARED previewer, not a dialog of this card's own (Bashar, 2026-08-30).

        The tiles stay here because they carry «استبدال» and «حذف» underneath, which no other
        gallery has; the frame — keyboard, focus, scroll-lock, the position counter — is
        `ImageSliderFrame`'s, so a photograph is read the same way here as on a property review.
        A dialog rather than a new tab: the picture is read AGAINST the complaint beside it.
      */}
      <ImageSliderFrame
        images={slides}
        at={preview}
        onChange={setPreview}
        labels={t.sections.slider}
      />
    </div>
  );
}
