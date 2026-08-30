'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirm } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import type { CityCategory } from '@/lib/api';
import { count } from '@/lib/format';
import { t, apiErrorOf, fill, plural } from '@/lib/strings';

/** The design's `grid-template-columns` for this table. */
const TEMPLATE = '.9fr 1fr 1fr 1fr .7fr .7fr .6fr';

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
  const c = t.sections.cityCategories;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const open = categories.find((one) => one.code === editing) ?? null;

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
    <Panel heading={c.addTitle} marker="add">
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
    <Panel heading={`${c.editTitle} — ${category.nameAr}`} marker={category.code}>
      <Row>
        <Field label={c.colNameAr} value={nameAr} onChange={setNameAr} />
        <Field label={c.colNameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.colNameDe} value={nameDe} onChange={setNameDe} />
      </Row>

      <p className="text-[10.5px] text-faint2">
        {plural(c.cityCount, { n: category.cities })}
      </p>

      <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-text2">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="size-[15px] cursor-pointer accent-gold"
        />
        {c.activeLabel}
      </label>

      <Actions
        busy={busy}
        error={error}
        ready={nameAr !== ''}
        onSave={() => void save()}
        onClose={onClose}
      />

      {dialog}
    </Panel>
  );
}

function Panel({
  heading,
  marker,
  children,
}: {
  readonly heading: string;
  readonly marker: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      data-category-form={marker}
      className="mb-3 grid w-full gap-3 rounded-[10px] border border-line bg-field p-4 text-start"
    >
      <p className="text-[11.5px] font-bold text-gold">{heading}</p>
      {children}
    </div>
  );
}

function Actions({
  busy,
  error,
  ready,
  onSave,
  onClose,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly ready: boolean;
  readonly onSave: () => void;
  readonly onClose: () => void;
}) {
  const c = t.sections.geo;

  return (
    <>
      {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={onSave}
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
    </>
  );
}

function Row({ children }: { readonly children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
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
