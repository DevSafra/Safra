'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { ImageSliderFrame, useConfirm, type SliderImage } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { count } from '@/lib/format';
import { t, apiErrorOf, cityCategories, fill } from '@/lib/strings';

/** The four the schema allows. A city may hold several — Petra is desert AND historic. */
const CATEGORIES = ['coastal', 'mountain', 'desert', 'historic'] as const;

export interface EditableCity {
  /* The two the table's own columns draw, carried so one row type serves both. */
  readonly country: string;
  readonly category: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly timezone: string;
  readonly categories: readonly string[];
  readonly isActive: boolean;
  readonly properties: number;
  readonly images: number;
  readonly heroUrl: string | null;
}

/**
 * Correcting a city, closing it, and giving it the photographs §5.4 asks for.
 *
 * ## The gap this closes
 *
 * Every row on المدن was a dead end: there was no city detail screen and no write path at all, so
 * a market could be opened only by a migration and could not be closed. `GEO_MANAGE` existed as a
 * permission and gated exactly one endpoint — city image upload — which no screen ever called, so
 * `city_images` held nothing for any of the nine cities while the public city page rendered a
 * gradient where the design asks for photography. Bashar asked for all of it (2026-08-30).
 *
 * ## Inline, not a detail screen
 *
 * Nine rows, three editable fields and a handful of photographs. A separate route would be a
 * navigation, a back link and a returnQuery for a form that fits under the row it belongs to.
 *
 * ## Closing a city says what it costs
 *
 * The confirmation names how many PUBLISHED properties leave the public search, because that is
 * the consequence and the flag alone does not show it. The same number goes into the audit row.
 */
function CityForm({
  city,
  onClose,
}: {
  readonly city: EditableCity;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.geo;
  const { ask, dialog } = useConfirm();

  const [nameAr, setNameAr] = useState(city.nameAr);
  const [nameEn, setNameEn] = useState(city.nameEn);
  const [nameDe, setNameDe] = useState(city.nameDe);
  const [timezone, setTimezone] = useState(city.timezone);
  const [categories, setCategories] = useState<string[]>([...city.categories]);
  const [isActive, setIsActive] = useState(city.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const slides: SliderImage[] = city.heroUrl
    ? [{ id: city.slug, thumb: city.heroUrl, full: city.heroUrl, caption: city.nameAr }]
    : [];

  async function save(): Promise<void> {
    /*
      Closing a city is the write with a public consequence, so it is confirmed and the sentence
      names the number. Re-opening one is not: it puts listings back where they were.
    */
    if (!isActive && city.isActive) {
      const go = await ask({
        title: c.closeCityTitle,
        message: fill(c.closeCityBody, { n: String(city.properties) }),
        confirmLabel: t.sections.dialog.confirm,
        cancelLabel: t.sections.dialog.cancel,
        tone: 'danger',
      });

      if (!go) return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/geo/cities/${encodeURIComponent(city.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameAr, nameEn, nameDe, timezone, categories, isActive }),
      });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  async function upload(chosen: File): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const body = new FormData();

      body.append('file', chosen);

      const response = await fetch(
        `/api/geo/cities/${encodeURIComponent(city.slug)}/images`,
        { method: 'POST', body },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  return (
    <div
      data-city-form={city.slug}
      className="mt-3 grid gap-3 rounded-[10px] border border-line bg-field p-3.5 text-start"
    >
      <p className="text-[11.5px] font-bold text-gold">
        {c.editCity} — {city.nameAr}
      </p>

      {/*
        No `dir` on any field — the page's own direction. A Latin run like `Asia/Damascus` lays out
        correctly inside an RTL field without being told, and `dir="ltr"` would move the field's
        start edge away from its label.
      */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
        <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
      </div>

      <Field
        label={c.timezone}
        value={timezone}
        onChange={setTimezone}
        hint={c.timezoneHint}
      />

      <fieldset className="grid gap-1.5">
        <legend className="text-[11.5px] font-semibold text-muted">
          {c.categoriesLabel}
        </legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <label
              key={category}
              className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-text2"
            >
              <input
                type="checkbox"
                checked={categories.includes(category)}
                onChange={(event) =>
                  setCategories((current) =>
                    event.target.checked
                      ? [...current, category]
                      : current.filter((one) => one !== category),
                  )
                }
                className="size-[15px] cursor-pointer accent-gold"
              />
              {cityCategories(category)}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-text2">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="size-[15px] cursor-pointer accent-gold"
        />
        {c.activeLabel}
      </label>

      {/* ── The photographs §5.4 asks for ─────────────────────────────────── */}
      <div className="grid gap-1.5 border-t border-line pt-3">
        <span className="text-[11.5px] font-semibold text-muted">{c.images}</span>

        <div className="flex flex-wrap items-center gap-2">
          {city.heroUrl ? (
            <button
              type="button"
              onClick={() => setPreview(0)}
              aria-label={t.sections.slider.open}
              className="block cursor-pointer"
            >
              <img
                src={city.heroUrl}
                alt=""
                loading="lazy"
                className="h-16 w-24 rounded-lg border border-line object-cover"
              />
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy}
            data-city-image-add={city.slug}
            onClick={() => file.current?.click()}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-dashed border-line px-3 py-1.5 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:opacity-50 lg:min-h-0"
          >
            {busy ? c.imagesUploading : c.imagesAdd}
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

              if (chosen) void upload(chosen);
            }}
          />
        </div>

        <p className="text-[10.5px] text-faint2">{c.imagesNote}</p>
      </div>

      {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-gold px-4.5 py-2 text-xs font-bold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? c.saving : c.save}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-xs font-bold text-muted transition-colors hover:text-text lg:min-h-0"
        >
          {c.cancel}
        </button>
      </div>

      <ImageSliderFrame
        images={slides}
        at={preview}
        onChange={setPreview}
        labels={t.sections.slider}
      />

      {dialog}
    </div>
  );
}

/**
 * The five columns the design draws.
 *
 * They live in the CLIENT component, and that is not a preference: a column's `render` is a
 * function, and «Functions cannot be passed directly to Client Components» — the geo page returned
 * a 500 for every request when they were defined server-side and handed across. The sixth column,
 * the editor's trigger, is built below where it can reach the open row's state.
 */
const CITY_COLUMNS: readonly AdminColumn<EditableCity>[] = [
  {
    key: 'city',
    header: t.sections.geo.cities,
    render: (row) => <span className="font-semibold text-text">{row.nameAr}</span>,
  },
  {
    key: 'country',
    header: t.sections.geo.colCountry,
    render: (row) => <span className="text-text2">{row.country}</span>,
  },
  {
    key: 'category',
    header: t.sections.geo.colCategory,
    render: (row) => <span className="text-muted">{cityCategories(row.category)}</span>,
  },
  {
    key: 'properties',
    header: t.sections.geo.colProperties,
    render: (row) => <span className="text-text2">{count(row.properties)}</span>,
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <StatusPill tone={row.isActive ? 'ok' : 'faint'}>
        {row.isActive ? t.sections.geo.active : t.sections.geo.inactive}
      </StatusPill>
    ),
  },
];

/**
 * The cities table, and the editor for whichever row is open.
 *
 * ## Why the list owns this and not the row
 *
 * The editor was rendered INSIDE a table cell first, and the screenshot said what that is: a
 * five-track grid given a sixth column squeezes every track, the city names truncated to «تراء»,
 * and a form with eight fields folded into a 40px column and stretched two thousand pixels down
 * the page. A form is not a cell. The row carries a TRIGGER; the panel opens below the table at
 * its full width, which is what `TablePagination` and every other full-width control here do.
 */
export function GeoCities({
  cities,
  template,
}: {
  readonly cities: readonly EditableCity[];
  readonly template: string;
}) {
  const c = t.sections.geo;
  const [editing, setEditing] = useState<string | null>(null);

  const open = cities.find((city) => city.slug === editing) ?? null;

  return (
    <>
      <AdminTable
        columns={[
          ...CITY_COLUMNS,
          {
            key: 'edit',
            header: c.edit,
            render: (row) => (
              <span className="flex items-center gap-2">
                {/* Whether this city HAS photography — the thing §5.4 turns on. */}
                <span
                  data-city-images={row.slug}
                  className={`text-[10.5px] ${row.images === 0 ? 'text-bad' : 'text-faint'}`}
                >
                  {row.images === 0
                    ? c.imagesNone
                    : fill(c.imagesCount, { n: String(row.images) })}
                </span>
                <button
                  type="button"
                  data-city-edit={row.slug}
                  onClick={() => setEditing(editing === row.slug ? null : row.slug)}
                  className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold"
                >
                  {c.edit}
                </button>
              </span>
            ),
          },
        ]}
        rows={[...cities]}
        template={template}
        rowKey={(row) => row.slug}
        minWidth={760}
        empty={t.table.empty}
      />

      {/*
        Keyed on the slug, so opening a second city REPLACES the first's form rather than reusing
        its state — the fields are initialised from props, and React would keep the old values.
      */}
      {open ? (
        <CityForm key={open.slug} city={open} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string | undefined;
}) {
  return (
    <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text placeholder:text-faint"
      />
      {hint ? (
        <span className="text-[10.5px] font-normal text-faint2">{hint}</span>
      ) : null}
    </label>
  );
}
