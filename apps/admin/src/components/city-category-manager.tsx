'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Modal, useConfirm } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { Actions, CheckboxField, Field, Panel, Row } from '@/components/geo-form';
import type { CityCategory } from '@/lib/api';
import { count } from '@/lib/format';
import { t, apiErrorOf, fill, plural } from '@/lib/strings';

/** The design's `grid-template-columns` for this table — the last track is the two arrows. */
const TEMPLATE = '.9fr 1fr 1fr 1fr .6fr .7fr .6fr .7fr';

/**
 * الفئات — city categories, managed on a screen rather than in a migration.
 *
 * ## What this replaces
 *
 * `city_category` was a `pgEnum`, so adding «ريفية» or correcting «ساحلية» meant a schema change,
 * a deployment and a release. Every other reference set on this platform is already a table for
 * that reason — `amenities` says it outright — and city categories were the one that was not.
 * Bashar asked for the page on 2026-08-30.
 *
 * ## A category is retired, never removed
 *
 * Cities are filed under it, and a deleted row would leave the customer city page printing a code
 * where a word belongs. Retiring takes it out of the pickers and leaves those cities intact, and
 * the confirmation says how many that is — the flag alone cannot answer «what did that change».
 *
 * ## The code is chosen once
 *
 * It is what the seed, the three translation catalogues and every existing filter key on, so it is
 * editable at creation and fixed afterwards. The NAMES are what a person changes.
 */
export function CityCategoryManager({
  categories,
}: {
  readonly categories: readonly CityCategory[];
}) {
  const router = useRouter();
  const c = t.sections.cityCategories;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);

  const open = categories.find((one) => one.code === editing) ?? null;

  /**
   * Moves one category one place, and REWRITES the whole order to match what is on screen.
   *
   * ## Why it does not simply swap two values
   *
   * `sort_order` decides the order every picker offers these in — the city editor, the add-city
   * form and the public filter — and the backfill gave the seeded rows values that need not be
   * distinct. Swapping two equal numbers changes nothing while reporting success, which is the
   * quiet failure this codebase keeps finding. So the new order is computed from the list the
   * reader is looking at, and every row whose position changed is written with its INDEX.
   *
   * At most a dozen rows, and only the rows that actually moved are sent.
   */
  async function move(code: string, by: -1 | 1): Promise<void> {
    const from = categories.findIndex((one) => one.code === code);
    const to = from + by;

    if (from < 0 || to < 0 || to >= categories.length) return;

    const next = [...categories];
    const [row] = next.splice(from, 1);

    if (!row) return;

    next.splice(to, 0, row);

    setMoving(true);

    try {
      for (const [index, one] of next.entries()) {
        if (one.sortOrder === index) continue;

        await fetch(`/api/geo/categories/${encodeURIComponent(one.code)}`, {
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

  const columns: readonly AdminColumn<CityCategory>[] = [
    {
      key: 'code',
      header: c.colCode,
      render: (row) => (
        <span className="font-mono text-[11.5px] text-faint">{row.code}</span>
      ),
    },
    {
      key: 'ar',
      header: c.colNameAr,
      render: (row) => <span className="font-semibold text-text">{row.nameAr}</span>,
    },
    {
      key: 'en',
      header: c.colNameEn,
      render: (row) => <span className="text-text2">{row.nameEn}</span>,
    },
    {
      key: 'de',
      header: c.colNameDe,
      render: (row) => <span className="text-text2">{row.nameDe}</span>,
    },
    {
      key: 'cities',
      header: c.colCities,
      render: (row) => <span className="text-text2">{count(row.cities)}</span>,
    },
    {
      key: 'status',
      header: c.colStatus,
      render: (row) => (
        <StatusPill tone={row.isActive ? 'ok' : 'faint'}>
          {row.isActive ? c.active : c.inactive}
        </StatusPill>
      ),
    },
    {
      key: 'order',
      header: c.colOrder,
      render: (row) => {
        const at = categories.findIndex((one) => one.code === row.code);

        return (
          <span className="flex items-center gap-1">
            {/*
              The arrows are NOT mirrored on this RTL screen. Up is up: a column ordered top to
              bottom reads the same in every language, and mirroring it would make «نقل لأعلى»
              move a row down. Each says where it goes in `aria-label`, because two identical
              glyphs in twelve rows are otherwise indistinguishable to a screen reader.
            */}
            <button
              type="button"
              disabled={moving || at <= 0}
              data-category-up={row.code}
              aria-label={`${c.moveUp} — ${row.nameAr}`}
              onClick={() => void move(row.code, -1)}
              className="cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-35"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={moving || at < 0 || at >= categories.length - 1}
              data-category-down={row.code}
              aria-label={`${c.moveDown} — ${row.nameAr}`}
              onClick={() => void move(row.code, 1)}
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
        <button
          type="button"
          data-category-edit={row.code}
          onClick={() => {
            setAdding(false);
            setEditing(editing === row.code ? null : row.code);
          }}
          className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold"
        >
          {c.edit}
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <h2 className="text-[14.5px] font-extrabold text-gold">{c.title}</h2>
        <span className="ms-auto">
          <button
            type="button"
            data-category-add
            aria-expanded={adding}
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.add}
          </button>
        </span>
      </div>

      {/* Full width, below the heading row — see `AddForm` on why not inside it. */}
      {adding ? <AddCategory onClose={() => setAdding(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...categories]}
        template={TEMPLATE}
        rowKey={(row) => row.code}
        minWidth={720}
        empty={c.empty}
      />

      {/* Keyed, so opening a second category re-initialises the fields from ITS props. */}
      {open ? (
        <EditCategory key={open.code} category={open} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function AddCategory({ onClose }: { readonly onClose: () => void }) {
  const router = useRouter();
  const c = t.sections.cityCategories;

  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/geo/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          nameAr,
          nameEn: nameEn || nameAr,
          nameDe: nameDe || nameAr,
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

  return (
    <Panel heading={c.addTitle} marker="add" attribute="data-category-form">
      <Row>
        <Field label={c.code} value={code} onChange={setCode} hint={c.codeHint} />
        <Field label={c.colNameAr} value={nameAr} onChange={setNameAr} />
      </Row>
      <Row>
        <Field label={c.colNameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.colNameDe} value={nameDe} onChange={setNameDe} />
      </Row>

      <Actions
        busy={busy}
        error={error}
        ready={code !== '' && nameAr !== ''}
        saveLabel={t.sections.geo.create}
        busyLabel={t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        onSave={() => void send()}
        onClose={onClose}
      />
    </Panel>
  );
}

function EditCategory({
  category,
  onClose,
}: {
  readonly category: CityCategory;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.cityCategories;
  const { ask, dialog } = useConfirm();

  const [nameAr, setNameAr] = useState(category.nameAr);
  const [nameEn, setNameEn] = useState(category.nameEn);
  const [nameDe, setNameDe] = useState(category.nameDe);
  const [isActive, setIsActive] = useState(category.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    /*
      Retiring one is the write with a consequence — it leaves the page and the search, and the
      cities filed under it keep their link. Re-activating is not: it puts a choice back.
    */
    if (!isActive && category.isActive) {
      const go = await ask({
        title: c.deactivateTitle,
        message: fill(c.deactivateBody, { n: String(category.cities) }),
        confirmLabel: t.sections.dialog.confirm,
        cancelLabel: t.sections.dialog.cancel,
        tone: 'danger',
      });

      if (!go) return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/geo/categories/${encodeURIComponent(category.code)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nameAr, nameEn, nameDe, isActive }),
        },
      );

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

  return (
    /* A popup, like every other edit on this screen and on المدن — Bashar, 2026-08-30. */
    <Modal
      title={`${c.editTitle} — ${category.nameAr}`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <Panel
        heading={`${c.editTitle} — ${category.nameAr}`}
        marker={category.code}
        attribute="data-category-form"
        bare
      >
        <Row>
          <Field label={c.code} value={category.code} disabled hint={c.codeHint} />
        </Row>

        <Row>
          <Field label={c.colNameAr} value={nameAr} onChange={setNameAr} />
          <Field label={c.colNameEn} value={nameEn} onChange={setNameEn} />
          <Field label={c.colNameDe} value={nameDe} onChange={setNameDe} />
        </Row>

        <p className="text-[10.5px] text-faint2">
          {plural(c.cityCount, { n: category.cities })}
        </p>

        <CheckboxField label={c.activeLabel} checked={isActive} onChange={setIsActive} />

        <Actions
          busy={busy}
          error={error}
          ready={nameAr !== ''}
          saveLabel={t.sections.geo.save}
          busyLabel={t.sections.geo.saving}
          cancelLabel={t.sections.geo.cancel}
          onSave={() => void save()}
          onClose={onClose}
        />
      </Panel>

      {dialog}
    </Modal>
  );
}
