'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirm } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { Actions, CheckboxField, Field, Panel, Row } from '@/components/geo-form';
import type { PartnerTypeRow } from '@/lib/api';
import { count } from '@/lib/format';
import { apiErrorOf, fill, plural, t } from '@/lib/strings';

/** Code · ar · en · de · partners · applications · status · edit. */
const TEMPLATE = '.9fr 1fr 1fr 1fr .6fr .6fr .6fr .5fr';

/**
 * أنواع الشركاء — what an applicant picks when they ask to join.
 *
 * ## Retiring is what closes a category of partner
 *
 * `partner-application.service.ts` and `partner-onboarding.service.ts` both ask for
 * `is_active = true` when they resolve a chosen type, so retiring one removes it from the joining
 * form immediately and leaves every partner already on it exactly as they were. That is the whole
 * mechanism for «we are not taking new restaurants this quarter», and it needed no deployment —
 * it needed a screen, which is what this is.
 *
 * ## Two counts, because two tables point here
 *
 * `partners` and `partner_applications` both hold a foreign key. The row shows them apart so a
 * reader understands a refusal to delete: a type with no partners can still have an outstanding
 * application against it, and the delete refuses on the sum.
 *
 * ## `capabilities` is not here
 *
 * The column exists on the table and **nothing in the application reads it**. An editor for it
 * would be a control that changes nothing while reading as coverage — see `catalogue.ts` in
 * `@safra/contracts` and the entry in `docs/FUTURE-WORK.md`. It gains an editor when it gains a
 * consumer, not before.
 */
export function PartnerTypeManager({
  partnerTypes,
}: {
  readonly partnerTypes: readonly PartnerTypeRow[];
}) {
  const router = useRouter();
  const c = t.sections.catalogue;

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const open = partnerTypes.find((one) => one.code === editing) ?? null;

  const columns: readonly AdminColumn<PartnerTypeRow>[] = [
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
      key: 'partners',
      header: c.colPartners,
      render: (row) => <span className="text-text2">{count(row.partners)}</span>,
    },
    {
      key: 'applications',
      header: c.colApplications,
      render: (row) => <span className="text-text2">{count(row.applications)}</span>,
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
          data-partner-type-edit={row.code}
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
        <h2 className="text-[14.5px] font-extrabold text-gold">{c.typesTitle}</h2>
        <span className="ms-auto">
          <button
            type="button"
            data-partner-type-add
            aria-expanded={adding}
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.typesAdd}
          </button>
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-faint">{c.typesNote}</p>

      {adding ? <PartnerTypeForm onClose={() => setAdding(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...partnerTypes]}
        template={TEMPLATE}
        rowKey={(row) => row.code}
        minWidth={760}
        empty={c.typesEmpty}
      />

      {open ? (
        <PartnerTypeForm
          key={open.code}
          partnerType={open}
          onClose={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function PartnerTypeForm({
  partnerType,
  onClose,
}: {
  readonly partnerType?: PartnerTypeRow | undefined;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.catalogue;
  const { ask, dialog } = useConfirm();

  const [code, setCode] = useState(partnerType?.code ?? '');
  const [nameAr, setNameAr] = useState(partnerType?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(partnerType?.nameEn ?? '');
  const [nameDe, setNameDe] = useState(partnerType?.nameDe ?? '');
  const [isActive, setActive] = useState(partnerType?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (partnerType && partnerType.isActive && !isActive) {
      const go = await ask({
        title: c.deactivateTypeTitle,
        message: fill(c.deactivateTypeBody, { n: String(partnerType.partners) }),
        confirmLabel: t.sections.dialog.confirm,
        cancelLabel: t.sections.dialog.cancel,
      });

      if (!go) return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        partnerType
          ? `/api/catalogue/partner-types/${encodeURIComponent(partnerType.code)}`
          : '/api/catalogue/partner-types',
        {
          method: partnerType ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            partnerType
              ? { nameAr, nameEn, nameDe, isActive }
              : { code, nameAr, nameEn: nameEn || nameAr, nameDe: nameDe || nameAr },
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
    if (!partnerType) return;

    const go = await ask({
      title: c.deleteTypeTitle,
      message: `${c.deleteTypeBody} ${c.reinstateHint}`,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/catalogue/partner-types/${encodeURIComponent(partnerType.code)}`,
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
      heading={partnerType ? c.typesEditTitle : c.typesAddTitle}
      marker={partnerType?.code ?? 'add'}
      attribute="data-partner-type-form"
    >
      <Row>
        {partnerType ? (
          <Field
            label={c.code}
            value={partnerType.code}
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

      {partnerType ? (
        <CheckboxField
          label={c.activeTypeLabel}
          checked={isActive}
          onChange={setActive}
          hint={plural(c.partnerCount, { n: partnerType.partners })}
        />
      ) : null}

      <Actions
        busy={busy}
        deleting={deleting}
        error={error}
        ready={(partnerType ? true : code !== '') && nameAr !== ''}
        saveLabel={partnerType ? t.sections.geo.save : t.sections.geo.create}
        busyLabel={partnerType ? t.sections.geo.saving : t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        {...(partnerType
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
