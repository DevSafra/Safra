'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AMENITY_CATEGORIES, type AmenityCategory } from '@safra/contracts';
import { useConfirm } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import {
  Actions,
  CheckboxField,
  Field,
  Panel,
  Row,
  SelectField,
} from '@/components/geo-form';
import type { AmenityRow } from '@/lib/api';
import { apiErrorOf, fill, plural, t } from '@/lib/strings';

/** Code · ar · en · de · group · filter · usage · status · edit. */
const TEMPLATE = '.8fr 1fr .9fr .9fr .7fr .6fr .7fr .6fr .5fr';

/**
 * الخدمات والمرافق — managed rather than migrated (Bashar, 2026-09-04).
 *
 * ## Two flags that are NOT the same flag
 *
 * `isActive` decides whether a partner may declare the amenity at all. `isFilterable` decides
 * whether it is a box in the search sidebar. They read alike and mean different things, and
 * collapsing them would let somebody tidying a cluttered filter stop partners describing a
 * facility they actually have. Both are on the row, separately, with their own words.
 *
 * ## Retiring keeps the links; deleting is refused while any exist
 *
 * An amenity four thousand units declare is retired, not removed — those units keep it, and it
 * simply stops being offered. One added by mistake this morning is deleted outright. The row shows
 * the count so the reader chooses rather than guesses, and the API refuses the delete with that
 * same count if they choose wrongly.
 */
export function AmenityManager({
  amenities,
}: {
  readonly amenities: readonly AmenityRow[];
}) {
  const router = useRouter();
  const c = t.sections.catalogue;

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const open = amenities.find((one) => one.code === editing) ?? null;

  const columns: readonly AdminColumn<AmenityRow>[] = [
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
      key: 'group',
      header: c.colGroup,
      render: (row) => <span className="text-text2">{groupLabel(row.category)}</span>,
    },
    {
      key: 'filter',
      header: c.colFilterable,
      render: (row) => (
        <StatusPill tone={row.isFilterable ? 'sky' : 'faint'}>
          {row.isFilterable ? c.active : c.inactive}
        </StatusPill>
      ),
    },
    {
      key: 'usage',
      header: c.colUsage,
      render: (row) => (
        <span className="text-text2">{plural(c.unitCount, { n: row.units })}</span>
      ),
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
          data-amenity-edit={row.code}
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
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-[14.5px] font-extrabold text-gold">{c.amenitiesTitle}</h2>
        <span className="ms-auto">
          <button
            type="button"
            data-amenity-add
            aria-expanded={adding}
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.amenitiesAdd}
          </button>
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-faint">{c.amenitiesNote}</p>

      {adding ? <AmenityForm onClose={() => setAdding(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...amenities]}
        template={TEMPLATE}
        rowKey={(row) => row.code}
        minWidth={860}
        empty={c.amenitiesEmpty}
      />

      {/* Keyed, so opening a second row re-initialises the fields from ITS props. */}
      {open ? (
        <AmenityForm
          key={open.code}
          amenity={open}
          onClose={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function groupLabel(category: string): string {
  const c = t.sections.catalogue;

  if (category === 'rules') return c.groupRules;
  if (category === 'accessibility') return c.groupAccessibility;

  return c.groupFacilities;
}

/**
 * One form for creating AND editing.
 *
 * The fields are identical apart from the code, which is chosen once and fixed afterwards. Two
 * forms would be two places to add the next field, and the one that got missed would be the one
 * nobody opened that week.
 */
function AmenityForm({
  amenity,
  onClose,
}: {
  readonly amenity?: AmenityRow | undefined;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.catalogue;
  const { ask, dialog } = useConfirm();

  const [code, setCode] = useState(amenity?.code ?? '');
  const [nameAr, setNameAr] = useState(amenity?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(amenity?.nameEn ?? '');
  const [nameDe, setNameDe] = useState(amenity?.nameDe ?? '');
  const [category, setCategory] = useState<AmenityCategory>(
    (amenity?.category as AmenityCategory | undefined) ?? 'facilities',
  );
  const [isFilterable, setFilterable] = useState(amenity?.isFilterable ?? true);
  const [isActive, setActive] = useState(amenity?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    /*
      Retiring one that units declare is the act with a consequence, so it is confirmed and the
      question names the count. Activating needs no confirmation — it takes nothing away.
    */
    if (amenity && amenity.isActive && !isActive) {
      const go = await ask({
        title: c.deactivateAmenityTitle,
        message: fill(c.deactivateAmenityBody, { n: String(amenity.units) }),
        confirmLabel: t.sections.dialog.confirm,
        cancelLabel: t.sections.dialog.cancel,
      });

      if (!go) return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        amenity
          ? `/api/catalogue/amenities/${encodeURIComponent(amenity.code)}`
          : '/api/catalogue/amenities',
        {
          method: amenity ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            amenity
              ? { nameAr, nameEn, nameDe, category, isFilterable, isActive }
              : {
                  code,
                  nameAr,
                  /* Arabic stands in where a translation has not been written yet. */
                  nameEn: nameEn || nameAr,
                  nameDe: nameDe || nameAr,
                  category,
                  isFilterable,
                },
          ),
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

  async function remove(): Promise<void> {
    if (!amenity) return;

    const go = await ask({
      title: c.deleteAmenityTitle,
      message: `${c.deleteAmenityBody} ${c.reinstateHint}`,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/catalogue/amenities/${encodeURIComponent(amenity.code)}`,
        { method: 'DELETE' },
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
      setDeleting(false);
    }
  }

  return (
    <Panel
      heading={amenity ? c.amenitiesEditTitle : c.amenitiesAddTitle}
      marker={amenity?.code ?? 'add'}
      attribute="data-amenity-form"
    >
      <Row>
        {amenity ? (
          <Field
            label={c.code}
            value={amenity.code}
            onChange={() => undefined}
            disabled
          />
        ) : (
          <Field label={c.code} value={code} onChange={setCode} hint={c.codeHint} />
        )}
        <Field label={c.colNameAr} value={nameAr} onChange={setNameAr} />
      </Row>
      <Row>
        <Field label={c.colNameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.colNameDe} value={nameDe} onChange={setNameDe} />
      </Row>
      <Row>
        <SelectField
          label={c.group}
          value={category}
          onChange={(value) => setCategory(value as AmenityCategory)}
        >
          {AMENITY_CATEGORIES.map((one) => (
            <option key={one} value={one}>
              {groupLabel(one)}
            </option>
          ))}
        </SelectField>
        <CheckboxField
          label={c.filterableLabel}
          checked={isFilterable}
          onChange={setFilterable}
        />
      </Row>

      {/* Only on an editor: a new amenity is offered from the moment it exists. */}
      {amenity ? (
        <CheckboxField
          label={c.activeAmenityLabel}
          checked={isActive}
          onChange={setActive}
          hint={plural(c.unitCount, { n: amenity.units })}
        />
      ) : null}

      <Actions
        busy={busy}
        deleting={deleting}
        error={error}
        ready={(amenity ? true : code !== '') && nameAr !== ''}
        saveLabel={amenity ? t.sections.geo.save : t.sections.geo.create}
        busyLabel={amenity ? t.sections.geo.saving : t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        {...(amenity
          ? {
              deleteLabel: c.remove,
              deletingLabel: c.removing,
              onDelete: () => void remove(),
            }
          : {})}
        onSave={() => void save()}
        onClose={onClose}
      />

      {dialog}
    </Panel>
  );
}
