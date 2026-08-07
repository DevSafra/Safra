'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PropertyImage } from '@/lib/api';
import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';

/** Matches `MAX_IMAGES_PER_PROPERTY` on the API — §5.5 rewards photo count, so it is capped. */
const MAX = 30;

/**
 * صور العقار — upload, order, cover, describe, archive.
 *
 * ## Nothing here deletes anything
 *
 * «أرشفة», not «حذف», and the confirmation says why: a photograph is evidence of what a listing
 * claimed on the day somebody booked it, and a dispute about "the room looked nothing like the
 * photo" is unanswerable if the photo is gone (P-003). The API soft-deletes and would refuse a
 * removal in any case.
 *
 * ## Ordering is buttons, not drag-and-drop
 *
 * Drag-and-drop is the obvious drawing and the wrong one here. It needs a pointer, so it fails on
 * the phone a partner actually uses; it is close to unusable with a keyboard or a screen reader
 * without a parallel control; and it needs a library on a screen that must work when the network
 * is poor. Two buttons per image do the same job for everybody. If drag-and-drop is added later it
 * belongs ALONGSIDE these, never instead of them.
 *
 * ## Every write re-reads
 *
 * `router.refresh()` after each action rather than mutating local state. The cover is an invariant
 * the SERVER maintains — archiving one promotes another — so guessing the new state here would be
 * a second implementation of a rule that already exists, and the two would disagree the first time
 * the rule changed.
 */
export function ImageManager({
  reference,
  images,
}: {
  readonly reference: string;
  readonly images: readonly PropertyImage[];
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<boolean> {
    if (busy) return false;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method: init.method,
        ...(init.body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(init.body),
            }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        setError(
          codeOf(payload) === 'image.last_one' ? t.images.lastImage : t.images.failed,
        );
        setBusy(false);
        return false;
      }

      router.refresh();
      setBusy(false);
      return true;
    } catch {
      setError(t.images.unreachable);
      setBusy(false);
      return false;
    }
  }

  async function upload(file: File) {
    if (busy) return;

    setBusy(true);
    setError(null);

    const body = new FormData();
    body.append('file', file);

    try {
      const response = await fetch(`/api/properties/${reference}/images`, {
        method: 'POST',
        body,
      });

      if (!response.ok) {
        setError(t.images.uploadFailed);
        setBusy(false);
        return;
      }

      router.refresh();
      setBusy(false);
    } catch {
      setError(t.images.unreachable);
      setBusy(false);
    }
  }

  /** Swap with the neighbour and send the WHOLE order — see `propertyImageOrderSchema`. */
  async function move(index: number, delta: number) {
    const next = [...images];
    const target = index + delta;

    if (target < 0 || target >= next.length) return;

    const a = next[index];
    const b = next[target];

    if (!a || !b) return;

    next[index] = b;
    next[target] = a;

    await act(`/api/properties/${reference}/images`, {
      method: 'PATCH',
      body: { imageIds: next.map((image) => image.id) },
    });
  }

  return (
    <div className="grid gap-3.5">
      <p className="text-[12px] leading-relaxed text-faint">{t.images.note}</p>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-[12.5px] text-bad"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-4 py-2 text-[13px] font-extrabold text-[#241A05] lg:min-h-0">
          {busy ? t.images.uploading : t.images.upload}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            disabled={busy || images.length >= MAX}
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) void upload(file);
              /* Cleared so re-picking the same file fires `change` again. */
              event.target.value = '';
            }}
          />
        </label>

        <span className="text-[11.5px] text-faint">
          {fill(t.images.count, { n: count(images.length), max: count(MAX) })}
        </span>
      </div>

      {images.length === 0 ? (
        <p className="text-[12.5px] text-faint">{t.images.empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {images.map((image, index) => (
            <li
              key={image.id}
              className={`overflow-hidden rounded-[14px] border bg-card ${
                image.isCover ? 'border-gold' : 'border-line'
              }`}
            >
              <div className="relative h-[150px] bg-field">
                {/*
                  A plain `<img>`, not `next/image`: the media host is configured per environment
                  and the pipeline has already rendered fixed variants, so there is nothing left to
                  optimise. `alt` is the partner's own text, or empty — a filename in an alt
                  attribute is worse than nothing for a screen-reader user.
                */}
                <img
                  src={image.urls.thumbnail}
                  alt={image.alt.ar ?? ''}
                  className="h-full w-full object-cover"
                />

                {image.isCover ? (
                  <span className="absolute top-2 start-2 rounded-full border border-gold bg-gold/20 px-2.5 py-0.5 text-[10.5px] font-bold text-gold">
                    {t.images.cover}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-2 p-3">
                <div className="flex flex-wrap gap-1.5">
                  {image.isCover ? null : (
                    <Small
                      onClick={() =>
                        void act(`/api/properties/${reference}/images/${image.id}`, {
                          method: 'POST',
                        })
                      }
                      label={t.images.makeCover}
                      disabled={busy}
                    />
                  )}
                  <Small
                    onClick={() => void move(index, -1)}
                    label={t.images.moveUp}
                    disabled={busy || index === 0}
                  />
                  <Small
                    onClick={() => void move(index, 1)}
                    label={t.images.moveDown}
                    disabled={busy || index === images.length - 1}
                  />
                  <Small
                    onClick={() => {
                      if (!window.confirm(t.images.archiveConfirm)) return;

                      void act(`/api/properties/${reference}/images/${image.id}`, {
                        method: 'DELETE',
                      });
                    }}
                    label={t.images.archive}
                    disabled={busy}
                    danger
                  />
                </div>

                <AltEditor
                  reference={reference}
                  image={image}
                  onSave={(value) =>
                    act(`/api/properties/${reference}/images/${image.id}`, {
                      method: 'PATCH',
                      body: { ar: value },
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AltEditor({
  image,
  onSave,
}: {
  readonly reference: string;
  readonly image: PropertyImage;
  readonly onSave: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(image.alt.ar ?? '');
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(value.trim()).then((ok) => setSaved(ok));
      }}
    >
      <label
        htmlFor={`alt-${image.id}`}
        className="text-[11px] leading-relaxed text-faint"
      >
        {t.images.altLabel}
      </label>
      <input
        id={`alt-${image.id}`}
        value={value}
        maxLength={300}
        onChange={(event) => {
          setValue(event.target.value);
          setSaved(false);
        }}
        className="min-h-10 rounded-lg border border-line bg-field px-2.5 py-1.5 text-[12px] text-text lg:min-h-0"
      />
      <button
        type="submit"
        className="min-h-10 w-fit cursor-pointer rounded-lg border border-line px-3 py-1 text-[11.5px] text-muted lg:min-h-0"
      >
        {saved ? t.images.altSaved : t.images.altSave}
      </button>
    </form>
  );
}

function Small({
  onClick,
  label,
  disabled,
  danger,
}: {
  readonly onClick: () => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-10 cursor-pointer rounded-lg border px-2.5 py-1 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0 ${
        danger ? 'border-bad/50 text-bad' : 'border-line text-muted'
      }`}
    >
      {label}
    </button>
  );
}

function codeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;

  const { code } = body;

  return typeof code === 'string' ? code : null;
}
