'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { LocationPicker, Modal, useConfirm } from '@safra/ui';
import { basemapBase } from '@safra/session';

import type { Landmark, LandmarkKind } from '@/lib/api';
import { LandmarkMark } from '@/components/landmark-mark';
import { Ltr, StatusPill } from '@/components/admin-table';
import { TablePagination } from '@/components/table-pagination';
import { apiErrorOf, t } from '@/lib/strings';

/**
 * Where the self-hosted basemap lives.
 *
 * Derived HERE rather than inside `LocationPicker`: Next inlines `process.env.NEXT_PUBLIC_*`
 * at build time and only compiles this app, so an env read inside the `tsc`-built shared
 * package would be `undefined` in the browser and the map would quietly not appear.
 */
const BASEMAP = basemapBase({
  NEXT_PUBLIC_BASEMAP_URL: process.env['NEXT_PUBLIC_BASEMAP_URL'],
  NEXT_PUBLIC_MEDIA_URL: process.env['NEXT_PUBLIC_MEDIA_URL'],
});

export interface RegistryCity {
  readonly slug: string;
  readonly nameAr: string;
  readonly latitude: string | null;
  readonly longitude: string | null;
}

/**
 * المعالم — the paged registry.
 *
 * ## The coordinates are set on a MAP, not typed
 *
 * The same control the partner portal uses, for a stronger reason: a landmark's position is
 * what every distance in its city is measured TO. A pair mistyped by a degree moves «800 م من
 * الجامع الأموي» by a hundred kilometres on every listing in Damascus, and nothing about the
 * screen would look wrong. `LANDMARK_MAX_KM_FROM_CITY` catches a transposed pair at the API;
 * the map is what stops one being entered in the first place.
 *
 * Full precision here, and that is not a contradiction with the property map. A landmark's
 * location is a published fact — the rounding protects a home, and a landmark is not one.
 */
export function LandmarkRegistry({
  items,
  total,
  capped,
  page,
  size,
  citySlug,
  kindCode,
  q,
  kinds,
  cities,
}: {
  readonly items: readonly Landmark[];
  readonly total: number;
  readonly capped: boolean;
  readonly page: number;
  readonly size: number;
  readonly citySlug: string | undefined;
  readonly kindCode: string | undefined;
  readonly q: string | undefined;
  readonly kinds: readonly LandmarkKind[];
  readonly cities: readonly RegistryCity[];
}) {
  const [editing, setEditing] = useState<Landmark | 'new' | null>(null);

  const pages = Math.max(1, Math.ceil(total / size));

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-16 font-bold text-text">{t.sections.landmarks.title}</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="min-h-10 cursor-pointer rounded-lg bg-gold px-3 text-13 font-extrabold text-ink lg:min-h-0 lg:py-1.5"
        >
          {t.sections.landmarks.add}
        </button>
      </div>

      {/*
        A GET form, so a filtered view is a shareable URL and reload-safe. `size` rides as a
        hidden field because paging out of a filtered view is the quiet failure this carries
        forward — the reader believes they are on page two of their search.
      */}
      <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="size" value={String(size)} />
        <label className="grid gap-1 text-12 text-muted">
          {t.sections.landmarks.search}
          <input
            name="q"
            defaultValue={q ?? ''}
            className="min-h-11 rounded-lg border border-line bg-field px-3 text-14 text-text"
          />
        </label>
        <label className="grid gap-1 text-12 text-muted">
          {t.sections.landmarks.colCity}
          <select
            name="citySlug"
            defaultValue={citySlug ?? ''}
            className="min-h-11 cursor-pointer rounded-lg border border-line bg-field px-3 text-14 text-text"
          >
            <option value="">{t.sections.landmarks.allCities}</option>
            {cities.map((city) => (
              <option key={city.slug} value={city.slug}>
                {city.nameAr}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-12 text-muted">
          {t.sections.landmarks.colKind}
          <select
            name="kindCode"
            defaultValue={kindCode ?? ''}
            className="min-h-11 cursor-pointer rounded-lg border border-line bg-field px-3 text-14 text-text"
          >
            <option value="">{t.sections.landmarks.allKinds}</option>
            {kinds.map((kind) => (
              <option key={kind.code} value={kind.code}>
                {kind.nameAr}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 cursor-pointer rounded-lg border border-line px-4 text-13 font-bold text-text transition-colors hover:border-gold"
        >
          {t.table.apply}
        </button>
      </form>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-start">
          <thead>
            <tr className="border-b border-line text-12 text-muted">
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.colName}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.colCity}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.colKind}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.colCoordinates}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.colStatus}
              </th>
              <th className="p-2 text-start font-normal" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-14 text-muted">
                  {t.sections.landmarks.empty}
                </td>
              </tr>
            ) : (
              items.map((landmark) => (
                <tr
                  key={landmark.slug}
                  className="border-b border-line/60 text-14 text-text"
                >
                  <td className="p-2">
                    <span className="flex items-center gap-2">
                      <LandmarkMark
                        paths={landmark.iconPaths}
                        className="shrink-0 text-gold-read"
                      />
                      <span>
                        <span className="block">{landmark.nameAr}</span>
                        <span className="block font-mono text-12 text-faint">
                          {landmark.slug}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="p-2">{landmark.cityNameAr}</td>
                  <td className="p-2">{landmark.kindNameAr}</td>
                  <td className="p-2 text-13 tabular-nums text-faint">
                    {/* A Latin RUN on an Arabic line — isolated so bidi does not reorder it. */}
                    <Ltr>{`${landmark.latitude}, ${landmark.longitude}`}</Ltr>
                  </td>
                  <td className="p-2">
                    <StatusPill tone={landmark.isActive ? 'ok' : 'faint'}>
                      {landmark.isActive
                        ? t.sections.landmarks.active
                        : t.sections.landmarks.inactive}
                    </StatusPill>
                  </td>
                  <td className="p-2 text-end">
                    <button
                      type="button"
                      onClick={() => setEditing(landmark)}
                      className="min-h-10 cursor-pointer text-13 font-bold text-gold-read underline-offset-4 hover:underline lg:min-h-0"
                    >
                      {t.sections.landmarks.edit}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Directly UNDER the table, which is where this bar is specified to sit. */}
      <TablePagination
        basePath="/landmarks"
        section="landmarks"
        query={{ citySlug, kindCode, q }}
        page={page}
        pages={pages}
        total={total}
        capped={capped}
        size={size}
      />

      {editing ? (
        <LandmarkEditor
          landmark={editing === 'new' ? null : editing}
          kinds={kinds}
          cities={cities}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function LandmarkEditor({
  landmark,
  kinds,
  cities,
  onDone,
}: {
  readonly landmark: Landmark | null;
  readonly kinds: readonly LandmarkKind[];
  readonly cities: readonly RegistryCity[];
  readonly onDone: () => void;
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();

  const [slug, setSlug] = useState(landmark?.slug ?? '');
  const [nameAr, setNameAr] = useState(landmark?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(landmark?.nameEn ?? '');
  const [nameDe, setNameDe] = useState(landmark?.nameDe ?? '');
  const [city, setCity] = useState(landmark?.citySlug ?? cities[0]?.slug ?? '');
  const [kind, setKind] = useState(landmark?.kindCode ?? kinds[0]?.code ?? '');
  const [latitude, setLatitude] = useState(landmark?.latitude ?? '');
  const [longitude, setLongitude] = useState(landmark?.longitude ?? '');
  const [isActive, setActive] = useState(landmark?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = cities.find((one) => one.slug === city);
  const placed = latitude !== '' && longitude !== '';

  async function save(): Promise<void> {
    if (busy || !placed) return;
    setBusy(true);
    setError(null);

    const body = landmark
      ? {
          citySlug: city,
          kindCode: kind,
          nameAr,
          nameEn,
          nameDe,
          latitude,
          longitude,
          isActive,
        }
      : {
          citySlug: city,
          kindCode: kind,
          slug,
          nameAr,
          nameEn,
          nameDe,
          latitude,
          longitude,
        };

    try {
      const response = await fetch(
        landmark
          ? `/api/landmarks/${encodeURIComponent(landmark.slug)}`
          : '/api/landmarks',
        {
          method: landmark ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        /*
          `apiErrorOf`, never `payload.message`. The API answers a CODE and an English sentence
          for the logs; printing that sentence is how English refusals reached an Arabic-only
          console four times before `no-english-refusals.test.ts` started sweeping for it.
        */
        setError(apiErrorOf(await response.json().catch(() => null)));
        setBusy(false);
        return;
      }

      router.refresh();
      onDone();
    } catch {
      setError(t.sections.landmarks.failed);
      setBusy(false);
    }
  }

  async function archive(): Promise<void> {
    if (!landmark || busy) return;

    const go = await ask({
      title: t.sections.landmarks.archiveTitle,
      message: t.sections.landmarks.archiveBody.replace('{name}', landmark.nameAr),
      confirmLabel: t.sections.landmarks.archive,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/landmarks/${encodeURIComponent(landmark.slug)}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok) {
        /*
          `apiErrorOf`, never `payload.message`. The API answers a CODE and an English sentence
          for the logs; printing that sentence is how English refusals reached an Arabic-only
          console four times before `no-english-refusals.test.ts` started sweeping for it.
        */
        setError(apiErrorOf(await response.json().catch(() => null)));
        setBusy(false);
        return;
      }

      router.refresh();
      onDone();
    } catch {
      setError(t.sections.landmarks.failed);
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        onClose={onDone}
        title={landmark ? t.sections.landmarks.editTitle : t.sections.landmarks.addTitle}
      >
        <div className="grid gap-3">
          {landmark ? null : (
            <Field
              label={t.sections.landmarks.slug}
              hint={t.sections.landmarks.slugHint}
              value={slug}
              onChange={setSlug}
            />
          )}
          <Field
            label={t.sections.landmarks.nameAr}
            value={nameAr}
            onChange={setNameAr}
          />
          <Field
            label={t.sections.landmarks.nameEn}
            value={nameEn}
            onChange={setNameEn}
          />
          <Field
            label={t.sections.landmarks.nameDe}
            value={nameDe}
            onChange={setNameDe}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-13 text-muted">
              {t.sections.landmarks.city}
              <select
                value={city}
                onChange={(event) => setCity(event.target.value)}
                className="min-h-11 cursor-pointer rounded-lg border border-line bg-field px-3 text-14 text-text"
              >
                {cities.map((one) => (
                  <option key={one.slug} value={one.slug}>
                    {one.nameAr}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-13 text-muted">
              {t.sections.landmarks.kind}
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="min-h-11 cursor-pointer rounded-lg border border-line bg-field px-3 text-14 text-text"
              >
                {kinds
                  .filter((one) => one.isActive || one.code === landmark?.kindCode)
                  .map((one) => (
                    <option key={one.code} value={one.code}>
                      {one.nameAr}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          {/*
            Keyed on the CITY, so choosing a different one rebuilds the map there rather than
            leaving the operator to pan across the country. The picker is built once and keeps
            its own view for exactly that reason, so the key is how a deliberate re-centre is
            expressed.
          */}
          <LocationPicker
            key={city}
            basemapUrl={BASEMAP}
            latitude={latitude}
            longitude={longitude}
            fallbackLatitude={chosen?.latitude ?? null}
            fallbackLongitude={chosen?.longitude ?? null}
            onChange={(next) => {
              setLatitude(next.latitude);
              setLongitude(next.longitude);
              setError(null);
            }}
            copy={{
              heading: t.sections.landmarks.locationHeading,
              help: t.sections.landmarks.locationHelp,
              missing: t.sections.landmarks.locationMissing,
              set: t.sections.landmarks.locationSet,
              clear: t.sections.landmarks.locationClear,
              coordinates: t.sections.landmarks.locationCoordinates,
              unavailable: t.sections.landmarks.locationUnavailable,
            }}
          />

          {landmark ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-14 text-text">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setActive(event.target.checked)}
                className="size-4 shrink-0 accent-gold"
              />
              {t.sections.landmarks.activeLabel}
            </label>
          ) : null}

          {error ? <p className="text-13 text-bad">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !placed}
              className="min-h-10 cursor-pointer rounded-lg bg-gold px-4 text-13 font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-2"
            >
              {t.sections.dialog.confirm}
            </button>
            {landmark ? (
              <button
                type="button"
                onClick={() => void archive()}
                disabled={busy}
                className="min-h-10 cursor-pointer rounded-lg border border-bad/50 px-4 text-13 font-bold text-bad disabled:opacity-50 lg:min-h-0 lg:py-2"
              >
                {t.sections.landmarks.archive}
              </button>
            ) : null}
          </div>
        </div>
      </Modal>
      {dialog}
    </>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  return (
    <label className="grid gap-1 text-13 text-muted">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-line bg-field px-3 text-14 text-text"
      />
      {hint ? <span className="text-12 text-faint">{hint}</span> : null}
    </label>
  );
}
