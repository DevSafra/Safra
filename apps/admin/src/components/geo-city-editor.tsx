'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Modal, useConfirm } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { CityPhotographs, type CityPhotograph } from '@/components/city-photographs';
import { Actions, CheckboxField, Field, Panel, Prose, Row } from '@/components/geo-form';
import { count } from '@/lib/format';
import { t, apiErrorOf, fill } from '@/lib/strings';

/**
 * The categories a city may be filed under — from the DATABASE, not a constant.
 *
 * It was a four-member array here and a four-member `pgEnum` there, so adding «ريفية» on الفئات
 * created a row nothing could select: the page existed and changed nothing, which is worse than
 * not having it. The active rows are passed down from the server, where they were read.
 */
export interface CategoryOption {
  readonly code: string;
  readonly nameAr: string;
}

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
  readonly countryActive: boolean;
  readonly sortOrder: number;
  readonly images: number;
  readonly heroUrl: string | null;
  /** Every photograph with what it says — see `CityPhotographs`. */
  readonly photographs: readonly CityPhotograph[];
  /** The prose §5.4 renders, editable here rather than only by a migration. */
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  readonly descriptionDe: string | null;
  readonly tagsAr: readonly string[];
  readonly tagsEn: readonly string[];
  readonly tagsDe: readonly string[];
}

/**
 * The tag strip, as one line a person types and as the array the API stores.
 *
 * A comma-separated field rather than a chip editor: eight short strings is a sentence's worth of
 * typing, and a bespoke chip control would be a component to build, test and translate for a value
 * that is edited a handful of times a year. Splitting on BOTH commas — «،» is the Arabic one, and
 * an Arabic keyboard produces it — because a reader typing the punctuation their language uses
 * must not silently end up with one long tag.
 */
function parseTags(value: string): string[] {
  return value
    .split(/[,،\n]/)
    .map((one) => one.trim())
    .filter((one) => one !== '');
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
 * ## A popup, not a detail screen and not a panel
 *
 * Nine rows, three editable fields and a handful of photographs. A separate route would be a
 * navigation, a back link and a returnQuery for a form this small. A panel under the table pushed
 * every row below it down the page, so Bashar asked for a popup (2026-08-30) — the same `Modal`
 * the country and currency editors open into.
 *
 * ## Closing a city says what it costs
 *
 * The confirmation names how many PUBLISHED properties leave the public search, because that is
 * the consequence and the flag alone does not show it. The same number goes into the audit row.
 */
function CityForm({
  city,
  categories: options,
  onClose,
}: {
  readonly city: EditableCity;
  readonly categories: readonly CategoryOption[];
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.geo;
  const { ask, dialog } = useConfirm();

  const [nameAr, setNameAr] = useState(city.nameAr);
  const [nameEn, setNameEn] = useState(city.nameEn);
  const [nameDe, setNameDe] = useState(city.nameDe);
  const [timezone, setTimezone] = useState(city.timezone);
  const [descriptionAr, setDescriptionAr] = useState(city.descriptionAr ?? '');
  const [descriptionEn, setDescriptionEn] = useState(city.descriptionEn ?? '');
  const [descriptionDe, setDescriptionDe] = useState(city.descriptionDe ?? '');
  const [tagsAr, setTagsAr] = useState(city.tagsAr.join('، '));
  const [tagsEn, setTagsEn] = useState(city.tagsEn.join(', '));
  const [tagsDe, setTagsDe] = useState(city.tagsDe.join(', '));
  const [categories, setCategories] = useState<string[]>([...city.categories]);
  const [isActive, setIsActive] = useState(city.isActive);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

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
        /*
          An empty description is sent as `null`, not `''` — the schema is `.nullable()`, so null
          is «clear it» and omitting the key would be «leave it». `''` would store an empty string,
          which reads the same on screen and is a different thing in the database.
        */
        body: JSON.stringify({
          nameAr,
          nameEn,
          nameDe,
          timezone,
          categories,
          isActive,
          descriptionAr: descriptionAr.trim() === '' ? null : descriptionAr.trim(),
          descriptionEn: descriptionEn.trim() === '' ? null : descriptionEn.trim(),
          descriptionDe: descriptionDe.trim() === '' ? null : descriptionDe.trim(),
          tagsAr: parseTags(tagsAr),
          tagsEn: parseTags(tagsEn),
          tagsDe: parseTags(tagsDe),
        }),
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

  /**
   * Removes the row, once somebody has confirmed what that costs.
   *
   * The refusal is the interesting path: the API answers a coded 409 naming how many records are
   * holding the row, and `apiErrorOf` resolves it to a sentence saying so and naming «أوقفها» as
   * the alternative. That is the whole reason the control is OFFERED rather than hidden — a person
   * who cannot delete needs to learn why and what to do instead, and a missing button teaches
   * neither.
   */
  async function remove(): Promise<void> {
    const go = await ask({
      title: c.deleteCityTitle,
      message: c.deleteCityBody,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/geo/cities/${encodeURIComponent(city.slug)}`, {
        method: 'DELETE',
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
      setDeleting(false);
    }
  }

  return (
    <Modal title={`${c.editCity} — ${city.nameAr}`} onClose={onClose} width="max-w-3xl">
      <Panel
        heading={`${c.editCity} — ${city.nameAr}`}
        marker={city.slug}
        attribute="data-city-form"
        bare
      >
        {/*
        No `dir` on any field — the page's own direction. A Latin run like `Asia/Damascus` lays out
        correctly inside an RTL field without being told, and `dir="ltr"` would move the field's
        start edge away from its label.
      */}
        <Row>
          <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
          <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
          <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
        </Row>

        <Row>
          <Field
            label={c.timezone}
            value={timezone}
            onChange={setTimezone}
            hint={c.timezoneHint}
          />
        </Row>

        {/*
          ── The prose §5.4 draws, which was reachable only by a migration ────────────────
          A textarea rather than a `Field`: this is a paragraph on the public city page, and a
          one-line input for it would make the operator scroll a sentence sideways to read it.
        */}
        <Row>
          <Prose
            label={c.descriptionAr}
            value={descriptionAr}
            onChange={setDescriptionAr}
            hint={c.descriptionHint}
          />
          <Prose
            label={c.descriptionEn}
            value={descriptionEn}
            onChange={setDescriptionEn}
          />
          <Prose
            label={c.descriptionDe}
            value={descriptionDe}
            onChange={setDescriptionDe}
          />
        </Row>

        <Row>
          <Field label={c.tagsAr} value={tagsAr} onChange={setTagsAr} hint={c.tagsHint} />
          <Field label={c.tagsEn} value={tagsEn} onChange={setTagsEn} />
          <Field label={c.tagsDe} value={tagsDe} onChange={setTagsDe} />
        </Row>

        <fieldset className="grid gap-1.5">
          <legend className="text-[11.5px] font-semibold text-muted">
            {c.categoriesLabel}
          </legend>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
              <label
                key={option.code}
                className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-text2"
              >
                <input
                  type="checkbox"
                  data-category-option={option.code}
                  checked={categories.includes(option.code)}
                  onChange={(event) =>
                    setCategories((current) =>
                      event.target.checked
                        ? [...current, option.code]
                        : current.filter((one) => one !== option.code),
                    )
                  }
                  className="size-[15px] cursor-pointer accent-gold"
                />
                {/* The row's own name, so a category renamed on الفئات reads correctly here. */}
                {option.nameAr}
              </label>
            ))}
          </div>
        </fieldset>

        <CheckboxField label={c.activeLabel} checked={isActive} onChange={setIsActive} />

        {/* ── The photographs §5.4 asks for ─────────────────────────────────── */}
        <div className="grid gap-1.5 border-t border-line pt-3">
          <span className="text-[11.5px] font-semibold text-muted">{c.images}</span>

          {/*
            Every photograph, each managing itself — see `CityPhotographs`. It was ONE thumbnail
            of the hero with no controls at all: no way to say what a picture shows, to move it,
            to choose a different hero, or to take one off.
          */}
          <CityPhotographs slug={city.slug} photographs={city.photographs} />

          <div className="flex flex-wrap items-center gap-2">
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

        <Actions
          busy={busy}
          ready
          error={error}
          saveLabel={c.save}
          busyLabel={c.saving}
          cancelLabel={c.cancel}
          deleteLabel={c.remove}
          deletingLabel={c.removing}
          deleting={deleting}
          onSave={() => void save()}
          onClose={onClose}
          onDelete={() => void remove()}
        />
      </Panel>

      {dialog}
    </Modal>
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
    /* Already the categories' own Arabic names — see `GeoService.cities`. */
    render: (row) => <span className="text-muted">{row.category}</span>,
  },
  {
    key: 'properties',
    header: t.sections.geo.colProperties,
    render: (row) => <span className="text-text2">{count(row.properties)}</span>,
  },
  {
    key: 'status',
    header: t.table.colStatus,
    /*
      A city in a CLOSED country reads «الدولة موقوفة», not «نشطة».

      Its own flag may well be true, and the row was not lying about the column — it was lying
      about what the column MEANS: nothing in that country is offered to a visitor or bookable
      through search, so «نشطة» stated something untrue about a place nobody could reach
      (Bashar, 2026-08-31). `warn` rather than `faint`, because this is not the same as a city
      somebody switched off and the two must not read alike on one screen.
    */
    render: (row) =>
      row.countryActive ? (
        <StatusPill tone={row.isActive ? 'ok' : 'faint'}>
          {row.isActive ? t.sections.geo.active : t.sections.geo.inactive}
        </StatusPill>
      ) : (
        <StatusPill tone="warn">{t.sections.geo.countryClosed}</StatusPill>
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
  categories,
  template,
}: {
  readonly cities: readonly EditableCity[];
  /** The ACTIVE categories, read from `city_categories` — see `CategoryOption`. */
  readonly categories: readonly CategoryOption[];
  readonly template: string;
}) {
  const router = useRouter();
  const c = t.sections.geo;
  const [editing, setEditing] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const open = cities.find((city) => city.slug === editing) ?? null;

  /**
   * Moves a city one place in the PUBLIC destinations grid.
   *
   * ## Why the whole order is rewritten rather than two values swapped
   *
   * The same reasoning الفئات is built on. `sort_order` values need not be distinct — every seeded
   * city was written with the same default — and swapping two equal numbers changes nothing while
   * reporting success, which is the quiet failure this codebase keeps finding. So the new order is
   * computed from the list on screen and every row whose position changed is written with its
   * INDEX. Only the rows that actually moved are sent.
   *
   * The list on screen IS the public order — the console read sorts by `sort_order` for exactly
   * this reason — so what the operator drags is what a visitor gets.
   */
  async function move(slug: string, by: -1 | 1): Promise<void> {
    const from = cities.findIndex((one) => one.slug === slug);
    const to = from + by;

    if (from < 0 || to < 0 || to >= cities.length) return;

    const next = [...cities];
    const [row] = next.splice(from, 1);

    if (!row) return;

    next.splice(to, 0, row);

    setMoving(true);

    try {
      for (const [index, one] of next.entries()) {
        if (one.sortOrder === index) continue;

        await fetch(`/api/geo/cities/${encodeURIComponent(one.slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: index }),
        });
      }

      router.refresh();
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      <AdminTable
        columns={[
          ...CITY_COLUMNS,
          {
            key: 'order',
            header: c.colOrder,
            render: (row) => {
              const at = cities.findIndex((one) => one.slug === row.slug);

              return (
                <span className="flex items-center gap-1">
                  {/*
                    Up is up. NOT mirrored on this RTL screen: a column ordered top to bottom reads
                    the same in every language, and mirroring would make «نقل لأعلى» move a row
                    down. Each names its direction and its city, because eighteen identical glyphs
                    are otherwise indistinguishable to a screen reader.
                  */}
                  <button
                    type="button"
                    disabled={moving || at <= 0}
                    data-city-up={row.slug}
                    aria-label={`${c.cityMoveUp} — ${row.nameAr}`}
                    onClick={() => void move(row.slug, -1)}
                    className="cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={moving || at < 0 || at >= cities.length - 1}
                    data-city-down={row.slug}
                    aria-label={`${c.cityMoveDown} — ${row.nameAr}`}
                    onClick={() => void move(row.slug, 1)}
                    className="cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    ↓
                  </button>
                </span>
              );
            },
          },
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
        <CityForm
          key={open.slug}
          city={open}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
