'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { isErrorCode } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

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

  const rendering = images.some((image) => image.status === 'processing');

  /**
   * Re-reads while anything is still rendering, and stops the moment nothing is.
   *
   * This screen is server-rendered and otherwise refreshes only after an ACTION, which was correct
   * while an upload returned a finished photograph. Since BullMQ phase 3 it returns a tile that
   * fills itself in a second or two later — so without this the partner watches «جارٍ التحضير…»
   * until they happen to reload, which is indistinguishable from a broken upload.
   *
   * Conditional on `rendering`, so a gallery of finished photographs polls NOTHING: an unconditional
   * interval would be every open property page in the estate re-rendering on the server every two
   * seconds, forever, to learn that nothing changed.
   *
   * Two seconds because a render takes about one. Faster would mostly catch itself mid-encode.
   */
  useEffect(() => {
    if (!rendering) return;

    const timer = setTimeout(() => router.refresh(), 2_000);

    return () => clearTimeout(timer);
    /* `images` is the dependency that matters: each refresh gives a new array, which re-arms this. */
  }, [rendering, images, router]);

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

  /**
   * Uploads a selection, ONE REQUEST AT A TIME.
   *
   * ## Why sequential and not parallel
   *
   * The encoding itself is no longer the reason — that moved to a worker in BullMQ phase 3, so ten
   * uploads are now ten fast requests and ten queued jobs rather than ten concurrent libvips runs.
   * What is left is the reason that never depended on it: the endpoint is throttled to twenty a
   * minute, and sequential requests make the two invariants hold. The FIRST
   * image becomes the cover, and each new one goes after the last. Both are computed from the rows
   * that exist when the request arrives, so parallel uploads race and the resulting order is
   * whatever the event loop decided.
   *
   * ## Why a partial failure is reported rather than rolled back
   *
   * Seven of ten succeeding is seven photographs the partner does not have to pick again. The
   * message names how many landed, so the screen and the gallery agree; silently stopping would
   * leave them re-uploading files that are already there.
   */
  async function upload(files: readonly File[]) {
    if (busy || files.length === 0) return;

    setBusy(true);
    setError(null);

    const room = MAX - images.length;
    const accepted = files.slice(0, Math.max(0, room));

    if (accepted.length === 0) {
      setError(fill(t.images.limitReached, { max: count(MAX) }));
      setBusy(false);
      return;
    }

    let done = 0;

    for (const file of accepted) {
      const body = new FormData();
      body.append('file', file);

      try {
        const response = await fetch(`/api/properties/${reference}/images`, {
          method: 'POST',
          body,
        });

        if (!response.ok) break;

        done += 1;
      } catch {
        setError(t.images.unreachable);
        setBusy(false);
        router.refresh();
        return;
      }
    }

    if (done < files.length) {
      setError(
        fill(t.images.uploadedSome, {
          done: count(done),
          total: count(files.length),
        }),
      );
    }

    router.refresh();
    setBusy(false);
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
            /* A gallery is filled in one go, not one file at a time. */
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            disabled={busy || images.length >= MAX}
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];

              if (chosen.length > 0) void upload(chosen);
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
                {/*
                  The picture is only rendered once it EXISTS.

                  A `processing` row carries the URLs its variants will have, and none of them
                  resolves yet — so drawing the `<img>` would put a broken-image glyph on the tile
                  for the second or two the encode takes, which is the single most alarming thing
                  this screen could show somebody who has just uploaded a photograph.
                */}
                {image.status === 'ready' ? (
                  <img
                    src={image.urls.thumbnail}
                    alt={image.alt.ar ?? ''}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center">
                    <span
                      className={`text-[12.5px] font-bold ${
                        image.status === 'failed' ? 'text-bad' : 'text-muted'
                      }`}
                    >
                      {image.status === 'failed'
                        ? t.images.failedState
                        : t.images.processing}
                    </span>
                    <span className="text-[10.5px] text-faint">
                      {image.status === 'failed'
                        ? reasonFor(image.failureCode)
                        : t.images.processingNote}
                    </span>
                  </div>
                )}

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
                  image={image}
                  onSave={(alt) =>
                    act(`/api/properties/${reference}/images/${image.id}`, {
                      method: 'PATCH',
                      body: alt,
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

/**
 * Alt text in every language the customer site serves.
 *
 * ## Why three fields and not one
 *
 * The alt attribute a visitor gets is chosen by THEIR locale. Storing three and editing one meant
 * an English or German visitor to a listing described only in Arabic saw `alt=""` — the same as no
 * description, on the field that exists for people who cannot see the photograph.
 *
 * ## All optional, saved together
 *
 * One submit for all three, because they describe one image and a partner filling in two of them
 * should not have to decide which to save first. Sending them together also means the API's
 * `PATCH` receives the complete state, so clearing a language is expressible — which it would not
 * be if each field posted only itself.
 */
function AltEditor({
  image,
  onSave,
}: {
  readonly image: PropertyImage;
  readonly onSave: (alt: { ar?: string; en?: string; de?: string }) => Promise<boolean>;
}) {
  const [alt, setAlt] = useState({
    ar: image.alt.ar ?? '',
    en: image.alt.en ?? '',
    de: image.alt.de ?? '',
  });
  const [saved, setSaved] = useState(false);

  const set = (locale: 'ar' | 'en' | 'de') => (value: string) => {
    setAlt((current) => ({ ...current, [locale]: value }));
    setSaved(false);
  };

  return (
    <form
      className="grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();

        /*
          Empty strings are sent as ABSENT rather than as `''`. The API stores `null` for a missing
          language, and a stored empty string would be indistinguishable from a description
          somebody deliberately wrote as blank — while rendering the same `alt=""` either way.
        */
        const trimmed = {
          ...(alt.ar.trim() ? { ar: alt.ar.trim() } : {}),
          ...(alt.en.trim() ? { en: alt.en.trim() } : {}),
          ...(alt.de.trim() ? { de: alt.de.trim() } : {}),
        };

        void onSave(trimmed).then((ok) => setSaved(ok));
      }}
    >
      <p className="text-[11px] leading-relaxed text-faint">{t.images.altLabel}</p>

      <AltField
        id={`alt-ar-${image.id}`}
        label={t.images.altAr}
        value={alt.ar}
        onChange={set('ar')}
        dir="rtl"
      />
      <AltField
        id={`alt-en-${image.id}`}
        label={t.images.altEn}
        value={alt.en}
        onChange={set('en')}
        dir="ltr"
      />
      <AltField
        id={`alt-de-${image.id}`}
        label={t.images.altDe}
        value={alt.de}
        onChange={set('de')}
        dir="ltr"
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

/**
 * One language's field.
 *
 * `dir` is per FIELD, not inherited from the page: an English description typed into an RTL input
 * has its punctuation reordered as you type, which looks like the app corrupting the text.
 */
function AltField({
  id,
  label,
  value,
  onChange,
  dir,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly dir: 'rtl' | 'ltr';
}) {
  return (
    <label className="grid gap-0.5">
      <span className="text-[10.5px] text-faint2">{label}</span>
      <input
        id={id}
        dir={dir}
        value={value}
        maxLength={300}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 rounded-lg border border-line bg-field px-2.5 py-1.5 text-[12px] text-text lg:min-h-0"
      />
    </label>
  );
}

/**
 * Turns a stored `failure_code` into a sentence in the reader's language.
 *
 * The API stores an ERROR CODE on the row, never a message: a `sharp` error would be English,
 * unlocalisable, and would quote whatever the uploaded file claimed about itself. `isErrorCode`
 * guards the lookup so a value that is not one of ours cannot be printed — a stored string is not
 * a place to trust blindly, even one only our own worker writes.
 */
function reasonFor(code: string | null): string {
  return code && isErrorCode(code) ? errorMessage(code, 'ar') : t.images.failedHint;
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
