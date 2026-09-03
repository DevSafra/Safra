'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ImageSliderFrame, useConfirm, type SliderImage } from '@safra/ui';

import { Field, Row } from '@/components/geo-form';
import { t, apiErrorOf } from '@/lib/strings';

/** One photograph as the editor manages it — the row's metadata plus a URL to draw it. */
export interface CityPhotograph {
  readonly id: string;
  readonly url: string;
  readonly altAr: string | null;
  readonly altEn: string | null;
  readonly altDe: string | null;
  readonly credit: string | null;
  readonly isHero: boolean;
  readonly sortOrder: number;
}

/**
 * Managing a city's photographs — what each one says, where it sits, and which one §5.4 draws.
 *
 * ## The gap this closes (Bashar, 2026-08-31)
 *
 * «Add management for city image metadata (hero image selection, alt text, sort order and credit)
 * so the public city pages can be managed correctly and accessibly.»
 *
 * Every one of these columns has existed since `city_images` was written and none could be
 * changed. The upload made the FIRST picture the hero and ordered the rest by arrival, and
 * `alt_ar/en/de` stayed NULL for ever — so every image on §5.4's hero band, which is the first
 * third of the public city page, went out with an empty `alt`. A screen reader announced nothing.
 * That is the accessibility half, and it is the half that matters most here.
 *
 * There was also no way to REMOVE one: the endpoint, the proxy route and the
 * `city_image.archived` audit action all existed and nothing called them — a capability with no
 * feature behind it, which reads as coverage.
 *
 * ## One card per photograph, each saving itself
 *
 * Not one submit for all twelve. A single save that half-succeeds leaves the operator unable to
 * tell which picture took the change, and the alt text they were writing is the thing they came
 * to check. Each card owns its own busy state and its own refusal.
 *
 * ## The hero and the order write immediately
 *
 * They are single decisions with no text to compose, so a «حفظ» beside them would be a second
 * press for something already expressed. The hero is exclusive server-side — the previous one is
 * cleared in the same transaction — so this never has to reason about two.
 */
export function CityPhotographs({
  slug,
  photographs,
}: {
  readonly slug: string;
  readonly photographs: readonly CityPhotograph[];
}) {
  const c = t.sections.geo;
  const [preview, setPreview] = useState<number | null>(null);

  /*
    Built from the props rather than held in state, so a refresh cannot leave a stale picture on
    screen — the lesson `DisputeEvidence` records. The caption is the alt text where there is one,
    because that is the string being managed and seeing it beside the picture is the check.
  */
  const slides: SliderImage[] = photographs.map((one) => ({
    id: one.id,
    thumb: one.url,
    full: one.url,
    caption: one.altAr ?? c.imageNoAlt,
  }));

  if (photographs.length === 0) return null;

  return (
    <div className="grid gap-2">
      {photographs.map((photograph, index) => (
        <PhotographCard
          key={photograph.id}
          slug={slug}
          photograph={photograph}
          /* Its place in the list it is actually drawn in — see `move`. */
          at={index}
          count={photographs.length}
          order={photographs.map((one) => one.id)}
          onOpen={() => setPreview(index)}
        />
      ))}

      {/* The two orders differ on purpose — see `GeoService.cities`. */}
      <p className="text-[10.5px] text-faint2">{c.imagesOrderNote}</p>

      <ImageSliderFrame
        images={slides}
        at={preview}
        onChange={setPreview}
        labels={t.sections.slider}
      />
    </div>
  );
}

function PhotographCard({
  slug,
  photograph,
  at,
  count,
  order,
  onOpen,
}: {
  readonly slug: string;
  readonly photograph: CityPhotograph;
  readonly at: number;
  readonly count: number;
  readonly order: readonly string[];
  readonly onOpen: () => void;
}) {
  const router = useRouter();
  const c = t.sections.geo;
  const { ask, dialog } = useConfirm();

  const [altAr, setAltAr] = useState(photograph.altAr ?? '');
  const [altEn, setAltEn] = useState(photograph.altEn ?? '');
  const [altDe, setAltDe] = useState(photograph.altDe ?? '');
  const [credit, setCredit] = useState(photograph.credit ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = `/api/geo/cities/${encodeURIComponent(slug)}/images/${encodeURIComponent(
    photograph.id,
  )}`;

  /**
   * Sends a change and refreshes, or leaves the refusal on this card.
   *
   * `body` is built by the caller so each control decides exactly which keys it sends: an absent
   * key means «leave it» and `null` means «clear it», and a helper that sent everything every time
   * would make those indistinguishable.
   */
  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return false;
      }

      router.refresh();

      return true;
    } catch {
      setError(t.errors.unreachable);

      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Saves what this photograph SAYS.
   *
   * An empty field is sent as `null`, not as `''`: a blank alt is a real state meaning «this image
   * is decorative», and storing an empty string instead would make «never written» and «chosen to
   * be empty» look different in the database while reading the same on screen.
   */
  async function save(): Promise<void> {
    const emptyToNull = (value: string): string | null =>
      value.trim() === '' ? null : value.trim();

    if (
      await send({
        altAr: emptyToNull(altAr),
        altEn: emptyToNull(altEn),
        altDe: emptyToNull(altDe),
        credit: emptyToNull(credit),
      })
    ) {
      setSaved(true);
    }
  }

  /**
   * Moves this photograph one place, rewriting the order from the list on screen.
   *
   * The same shape الفئات uses, and for the same reason: `sort_order` values need not be distinct
   * — the upload assigns them by arrival and the hero is drawn first regardless — so swapping two
   * equal numbers would change nothing while reporting success.
   */
  async function move(by: -1 | 1): Promise<void> {
    const to = at + by;

    if (to < 0 || to >= count) return;

    const next = [...order];
    const [moved] = next.splice(at, 1);

    if (!moved) return;

    next.splice(to, 0, moved);

    setBusy(true);
    setError(null);

    try {
      for (const [index, id] of next.entries()) {
        await fetch(
          `/api/geo/cities/${encodeURIComponent(slug)}/images/${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortOrder: index }),
          },
        );
      }

      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    const go = await ask({
      title: c.imageRemoveTitle,
      message: c.imageRemoveBody,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, { method: 'DELETE' });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  const control =
    'cursor-pointer rounded-lg border border-line px-2 py-0.5 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <div
      data-city-photograph={photograph.id}
      className="grid gap-2.5 rounded-card border border-line bg-field p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={onOpen}
          aria-label={t.sections.slider.open}
          className="shrink-0 cursor-pointer"
        >
          {/*
            `alt=""` on the THUMBNAIL, deliberately: the picture is decorative HERE — the control
            beside it is labelled, and the alt text being managed is in the field below, where it
            is read as data rather than announced as the image's own description.
          */}
          <img
            src={photograph.url}
            alt=""
            loading="lazy"
            className={`h-16 w-24 rounded-lg border object-cover ${
              photograph.isHero ? 'border-[rgba(var(--goldA),0.6)]' : 'border-line'
            }`}
          />
        </button>

        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {photograph.isHero ? (
              <span className="rounded-full bg-[rgba(var(--goldA),0.14)] px-2.5 py-0.5 text-[10px] font-extrabold text-gold-ink">
                {c.imageHero}
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                data-city-hero={photograph.id}
                onClick={() => void send({ isHero: true })}
                className={control}
              >
                {c.imageMakeHero}
              </button>
            )}

            {/* Whether this picture says anything at all — the state this screen exists to fix. */}
            {photograph.altAr === null ? (
              <span className="text-[10.5px] font-semibold text-bad">{c.imageNoAlt}</span>
            ) : null}

            <span className="ms-auto flex items-center gap-1">
              {/*
                Up is up. The arrows are NOT mirrored on this RTL screen — a column ordered top to
                bottom reads the same in every language, and mirroring would make «نقل لأعلى» move
                a row down. Each names its direction, because two glyphs repeated per card are
                otherwise indistinguishable to a screen reader.
              */}
              <button
                type="button"
                disabled={busy || at === 0}
                aria-label={c.imageMoveUp}
                data-city-image-up={photograph.id}
                onClick={() => void move(-1)}
                className={control}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || at >= count - 1}
                aria-label={c.imageMoveDown}
                data-city-image-down={photograph.id}
                onClick={() => void move(1)}
                className={control}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={c.imageRemove}
                data-city-image-remove={photograph.id}
                onClick={() => void remove()}
                className="cursor-pointer rounded-lg border border-bad/45 px-2 py-0.5 text-[10.5px] font-bold text-bad transition-colors hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {c.remove}
              </button>
            </span>
          </div>

          <Row>
            <Field
              label={`${c.imageAlt} — ${c.nameAr}`}
              value={altAr}
              onChange={setAltAr}
              hint={c.imageAltHint}
            />
            <Field
              label={`${c.imageAlt} — ${c.nameEn}`}
              value={altEn}
              onChange={setAltEn}
            />
            <Field
              label={`${c.imageAlt} — ${c.nameDe}`}
              value={altDe}
              onChange={setAltDe}
            />
          </Row>

          <Row>
            <Field
              label={c.imageCredit}
              value={credit}
              onChange={setCredit}
              hint={c.imageCreditHint}
            />
          </Row>

          {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              data-city-image-save={photograph.id}
              onClick={() => void save()}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11px] font-bold text-gold-ink transition-colors hover:bg-[rgba(var(--goldA),0.08)] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
            >
              {busy ? c.saving : c.save}
            </button>
            {saved ? (
              <span className="text-[10.5px] font-semibold text-ok">{c.imageSaved}</span>
            ) : null}
          </div>
        </div>
      </div>

      {dialog}
    </div>
  );
}
