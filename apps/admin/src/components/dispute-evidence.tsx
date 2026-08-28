'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      setSlow(false);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

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
              A link, so a photograph can be opened at its own size — the whole point of it is to be
              looked at closely. `alt=""` because the picture IS the content: a description invented
              here would be a claim about somebody's room that nobody made.
            */
            <a
              key={one.id}
              href={fileHref(one.id)}
              target="_blank"
              rel="noreferrer"
              title={one.fileName}
              data-evidence={one.id}
              className="block"
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
            </a>
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
    </div>
  );
}
