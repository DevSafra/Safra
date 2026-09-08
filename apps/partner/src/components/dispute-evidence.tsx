'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ImageSlider, type SliderImage } from '@safra/ui';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/** How often, and how many times, the card asks whether a photograph has finished rendering. */
const POLL_EVERY_MS = 2_000;
const POLL_ATTEMPTS = 20;

/**
 * The photographs on a dispute, from the partner's side — and the control that adds one.
 *
 * ## Why the host may file evidence at all
 *
 * Bashar, 2026-09-08: *«The partner should be able to upload supporting evidence and documents…
 * I want SAFRA to function as a proper adjudicator that hears both sides.»* «الغرفة لا تطابق الصور
 * المنشورة» is settled by comparing photographs, and until this existed only the guest could
 * produce any — so one side of a comparison decided it.
 *
 * ## What is shown here is what the SERVER re-encoded
 *
 * Never the bytes that were chosen. The worker decodes and re-encodes every upload, which destroys
 * anything active in the file and strips EXIF — including the GPS coordinates in a photograph taken
 * inside a property. `rendered` is false until it has run, so a placeholder appears first and the
 * picture replaces it; without that the host would meet a broken image seconds after being told
 * their upload succeeded.
 *
 * ## The shared previewer, not a gallery of its own
 *
 * `ImageSlider` from `@safra/ui` — keyboard, focus handling, the scroll lock, the position counter
 * and the zoom are all its. Four hand-rolled galleries is what the project rule exists to prevent,
 * and evidence was one of them: it used to open the raw file in a new tab, so reading a picture
 * meant leaving the complaint it was about.
 */
export function DisputeEvidence({
  reference,
  closed,
  evidence,
}: {
  readonly reference: string;
  /** A settled dispute takes no more evidence — the API refuses it, and no control is offered. */
  readonly closed: boolean;
  readonly evidence: readonly {
    readonly id: string;
    readonly fileName: string;
    readonly rendered: boolean;
    readonly mine: boolean;
  }[];
}) {
  const router = useRouter();
  const c = t.disputes;

  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const pending = evidence.filter((one) => !one.rendered).length;

  /*
    THIS origin, not the object store.

    Evidence is private, so the `disputes/` prefix is deliberately absent from the bucket's
    anonymous read policy and there is no public address to put in a `src`. An image tag cannot
    send a bearer token but it does send this origin's cookie, and the route behind this path
    exchanges one for the other — then answers only for a file this partner may actually open.
  */
  const fileHref = (id: string): string =>
    `/api/disputes/evidence/${encodeURIComponent(id)}/file`;

  /*
    While something is still rendering, ask again.

    The upload returns the moment the bytes are parked — the variants are written by a WORKER — so
    a single refresh at upload time always re-reads a row that is still unrendered, and the
    placeholder would sit there until somebody reloaded by hand. Bounded rather than open-ended:
    twenty attempts at two seconds is comfortably past the render, and a job that died leaves a
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

  async function send(chosen: File): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const body = new FormData();

      body.append('file', chosen);

      const response = await fetch(
        `/api/disputes/${encodeURIComponent(reference)}/evidence`,
        { method: 'POST', body },
      );

      if (!response.ok) {
        setError(refusalFor(await codeOfResponse(response)) ?? c.respondFailed);

        return;
      }

      setSlow(false);
      router.refresh();
    } catch {
      setError(t.dashboard.unreachable);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  /*
    Only what has RENDERED can be previewed — a frame over a placeholder shows nothing. Built from
    the list on every render rather than held in state, so a refresh cannot leave a stale picture
    on screen.
  */
  const slides: SliderImage[] = evidence
    .filter((one) => one.rendered)
    .map((one) => ({
      id: one.id,
      thumb: fileHref(one.id),
      full: fileHref(one.id),
      caption: one.fileName,
      /* Whose picture it is. A file SAFRA released reads differently from one the host filed. */
      badge: one.mine ? c.evidenceMine : c.evidenceShared,
    }));

  return (
    <>
      {evidence.length === 0 ? (
        <p className="mt-1.5 text-[14px] text-faint">{c.evidenceNone}</p>
      ) : (
        <ImageSlider images={slides} labels={t.slider} tileClassName="h-20 w-28" />
      )}

      {/*
        The files whose variants the worker has not written yet.

        Rendered outside the slider rather than as a grey tile inside it: the slider's tiles OPEN
        something, and a tile that opens an empty frame is a control that changes nothing.
      */}
      {pending > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {evidence
            .filter((one) => !one.rendered)
            .map((one) => (
              <li
                key={one.id}
                data-evidence-pending={one.id}
                className="grid h-20 w-28 place-items-center rounded-lg border border-dashed border-line px-2 text-center text-[14px] leading-tight text-faint"
              >
                {slow ? c.evidenceSlow : c.evidenceProcessing}
              </li>
            ))}
        </ul>
      ) : null}

      {closed ? (
        <p className="mt-3 text-[13px] text-faint">{c.evidenceClosedNote}</p>
      ) : (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-[13px] leading-relaxed text-faint">{c.evidenceHint}</p>

          <button
            type="button"
            disabled={busy}
            onClick={() => file.current?.click()}
            className="min-h-10 cursor-pointer rounded-lg border border-line bg-field px-4 py-2 text-[14px] font-bold text-text transition-colors duration-150 ease-out-strong hover:border-gold hover:text-gold-read disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none lg:min-h-0"
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
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-bad">
          {error}
        </p>
      ) : null}
    </>
  );
}
