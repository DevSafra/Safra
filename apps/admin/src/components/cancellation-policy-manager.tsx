'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirm } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { Actions, CheckboxField, Field, Panel, Prose, Row } from '@/components/geo-form';
import type { CancellationPolicyRow, CancellationTierRow } from '@/lib/api';
import { count } from '@/lib/format';
import { apiErrorOf, fill, plural, t } from '@/lib/strings';

/** Code · ar · ladder · floor · properties · status · edit. */
const TEMPLATE = '.8fr 1fr 1.4fr .6fr .6fr .6fr .5fr';

/**
 * سياسات الإلغاء — the refund ladder, managed rather than migrated.
 *
 * ## The sentence this screen must carry
 *
 * Every booking stores a SNAPSHOT of its policy at creation, and `refund.service.ts` reads that
 * snapshot. So editing a ladder here changes what FUTURE bookings refund and nothing about a live
 * one. A super admin who believes otherwise is wrong in a direction that costs money, and the note
 * above the table says so before they touch anything — this is the one screen in the console where
 * the explanation matters more than the control.
 *
 * ## The ladder is rows, not JSON
 *
 * It is `jsonb` in the database and a textarea of JSON would have been a third of the code. It
 * would also have made a misplaced brace into a policy that refunds nothing, discovered by a guest.
 * Each step is two numbers with their own labels, added and removed one at a time, and the summary
 * column renders the ladder as sentences so a reader checks it by reading rather than by parsing.
 *
 * ## Ordering is not the reader's problem
 *
 * `refund.service.ts` sorts descending by hours and takes the first match, so the steps may be
 * entered in any order. The summary shows them sorted the way the service will read them, which is
 * how somebody notices they have written 24h → 50% above 48h → 100% and meant it the other way.
 */
export function CancellationPolicyManager({
  policies,
}: {
  readonly policies: readonly CancellationPolicyRow[];
}) {
  const router = useRouter();
  const c = t.sections.catalogue;

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const open = policies.find((one) => one.code === editing) ?? null;

  const columns: readonly AdminColumn<CancellationPolicyRow>[] = [
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
      key: 'tiers',
      header: c.colTiers,
      render: (row) => (
        <span className="text-[11px] text-text2">{ladder(row.tiers).join(' · ')}</span>
      ),
    },
    {
      key: 'floor',
      header: c.colFloor,
      render: (row) => (
        <span className="text-text2 tabular-nums">{count(row.minRefundPercent)}٪</span>
      ),
    },
    {
      key: 'properties',
      header: c.colProperties,
      render: (row) => <span className="text-text2">{count(row.properties)}</span>,
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
          data-policy-edit={row.code}
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
        <h2 className="text-[14.5px] font-extrabold text-gold">{c.policiesTitle}</h2>
        <span className="ms-auto">
          <button
            type="button"
            data-policy-add
            aria-expanded={adding}
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.policiesAdd}
          </button>
        </span>
      </div>

      {/*
        `text-gold` on a bordered strip, not `text-faint` like the other two notes: this is the one
        that prevents a costly misunderstanding rather than merely explaining a screen.
      */}
      <p className="rounded-card border border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.06)] p-3 text-[11.5px] leading-relaxed text-gold">
        {c.policiesNote}
      </p>

      {adding ? <PolicyForm onClose={() => setAdding(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...policies]}
        template={TEMPLATE}
        rowKey={(row) => row.code}
        minWidth={880}
        empty={c.policiesEmpty}
      />

      {open ? (
        <PolicyForm
          key={open.code}
          policy={open}
          onClose={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * The ladder as sentences, sorted the way `refund.service.ts` reads it.
 *
 * Descending by hours, because that is the order the service resolves them in — a summary sorted
 * any other way would describe a different policy from the one that will run.
 */
function ladder(tiers: readonly CancellationTierRow[]): string[] {
  return [...tiers]
    .sort((a, b) => b.hoursBeforeCheckIn - a.hoursBeforeCheckIn)
    .map((tier) =>
      fill(t.sections.catalogue.tierSummary, {
        hours: count(tier.hoursBeforeCheckIn),
        percent: count(tier.refundPercent),
      }),
    );
}

function PolicyForm({
  policy,
  onClose,
}: {
  readonly policy?: CancellationPolicyRow | undefined;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.catalogue;
  const { ask, dialog } = useConfirm();

  const [code, setCode] = useState(policy?.code ?? '');
  const [nameAr, setNameAr] = useState(policy?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(policy?.nameEn ?? '');
  const [nameDe, setNameDe] = useState(policy?.nameDe ?? '');
  const [descriptionAr, setDescriptionAr] = useState(policy?.descriptionAr ?? '');
  const [descriptionEn, setDescriptionEn] = useState(policy?.descriptionEn ?? '');
  const [descriptionDe, setDescriptionDe] = useState(policy?.descriptionDe ?? '');
  const [floor, setFloor] = useState(String(policy?.minRefundPercent ?? 50));
  const [tiers, setTiers] = useState<CancellationTierRow[]>(
    policy ? [...policy.tiers] : [{ hoursBeforeCheckIn: 48, refundPercent: 100 }],
  );
  const [isActive, setActive] = useState(policy?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTier = (index: number, patch: Partial<CancellationTierRow>) =>
    setTiers((current) =>
      current.map((tier, at) => (at === index ? { ...tier, ...patch } : tier)),
    );

  async function save(): Promise<void> {
    if (policy && policy.isActive && !isActive) {
      const go = await ask({
        title: c.deactivatePolicyTitle,
        message: fill(c.deactivatePolicyBody, { n: String(policy.properties) }),
        confirmLabel: t.sections.dialog.confirm,
        cancelLabel: t.sections.dialog.cancel,
      });

      if (!go) return;
    }

    setBusy(true);
    setError(null);

    const shared = {
      nameAr,
      nameEn: nameEn || nameAr,
      nameDe: nameDe || nameAr,
      descriptionAr,
      descriptionEn: descriptionEn || descriptionAr,
      descriptionDe: descriptionDe || descriptionAr,
      tiers,
      minRefundPercent: Number(floor),
    };

    try {
      const response = await fetch(
        policy
          ? `/api/catalogue/cancellation-policies/${encodeURIComponent(policy.code)}`
          : '/api/catalogue/cancellation-policies',
        {
          method: policy ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(policy ? { ...shared, isActive } : { code, ...shared }),
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
    if (!policy) return;

    const go = await ask({
      title: c.deletePolicyTitle,
      message: `${c.deletePolicyBody} ${c.reinstateHint}`,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/catalogue/cancellation-policies/${encodeURIComponent(policy.code)}`,
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
      heading={policy ? c.policiesEditTitle : c.policiesAddTitle}
      marker={policy?.code ?? 'add'}
      attribute="data-policy-form"
    >
      <Row>
        {policy ? (
          <Field label={c.code} value={policy.code} onChange={() => undefined} disabled />
        ) : (
          <Field label={c.code} value={code} onChange={setCode} hint={c.codeHint} />
        )}
        <Field label={c.colNameAr} value={nameAr} onChange={setNameAr} />
      </Row>
      <Row>
        <Field label={c.colNameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.colNameDe} value={nameDe} onChange={setNameDe} />
      </Row>

      <Prose label={c.descriptionAr} value={descriptionAr} onChange={setDescriptionAr} />
      <Row>
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

      {/* ── The ladder ── */}
      <div className="grid gap-2 rounded-card border border-line bg-card p-3">
        <p className="text-[11.5px] font-bold text-gold">{c.tiers}</p>
        <p className="text-[10.5px] leading-relaxed text-faint2">{c.tiersHint}</p>

        {tiers.map((tier, index) => (
          <div
            /* Index-keyed deliberately: a step has no identity of its own, only a position. */
            key={index}
            data-tier={index}
            className="flex flex-wrap items-end gap-2"
          >
            <span className="min-w-[9rem] flex-1">
              <Field
                label={c.tierHours}
                value={String(tier.hoursBeforeCheckIn)}
                onChange={(value) =>
                  setTier(index, { hoursBeforeCheckIn: Number(value) || 0 })
                }
              />
            </span>
            <span className="min-w-[9rem] flex-1">
              <Field
                label={c.tierPercent}
                value={String(tier.refundPercent)}
                onChange={(value) =>
                  setTier(index, { refundPercent: Number(value) || 0 })
                }
              />
            </span>
            <button
              type="button"
              /* The last step cannot go: a policy with no ladder refunds by the floor alone. */
              disabled={tiers.length <= 1}
              data-tier-remove={index}
              aria-label={`${c.tierRemove} ${index + 1}`}
              onClick={() =>
                setTiers((current) => current.filter((_, at) => at !== index))
              }
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 text-[11px] text-muted transition-colors hover:border-bad/50 hover:text-bad disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0 lg:py-1.5"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          data-tier-add
          disabled={tiers.length >= 8}
          onClick={() =>
            setTiers((current) => [
              ...current,
              { hoursBeforeCheckIn: 0, refundPercent: 50 },
            ])
          }
          className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-line px-3 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0 lg:py-1.5"
        >
          {c.tierAdd}
        </button>

        {/* Read back in the order the refund service will apply it — see `ladder`. */}
        <p className="text-[11px] text-text2">{ladder(tiers).join(' · ')}</p>
      </div>

      <Row>
        <Field label={c.floor} value={floor} onChange={setFloor} hint={c.floorHint} />
        {policy ? (
          <CheckboxField
            label={c.activePolicyLabel}
            checked={isActive}
            onChange={setActive}
            hint={plural(c.propertyCount, { n: policy.properties })}
          />
        ) : (
          <span />
        )}
      </Row>

      <Actions
        busy={busy}
        deleting={deleting}
        error={error}
        ready={(policy ? true : code !== '') && nameAr !== '' && descriptionAr !== ''}
        saveLabel={policy ? t.sections.geo.save : t.sections.geo.create}
        busyLabel={policy ? t.sections.geo.saving : t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        {...(policy
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
