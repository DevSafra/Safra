'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirm, statusTone } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { Actions, Field, Panel, Row } from '@/components/geo-form';
import type { SafraPayout } from '@/lib/api';
import { amount } from '@/lib/format';
import { apiErrorOf, label, t } from '@/lib/strings';

/** Reference · period · net · destination · status · paid · actions. */
const TEMPLATE = '.8fr .9fr .8fr .9fr .7fr .7fr 1.1fr';

/**
 * تحويلات إيرادات سفرة — the lifecycle that collects what the platform has earned.
 *
 * ## Marking paid is the only step that writes the books
 *
 * Opening and releasing are intent. The confirmation before «تسجيل مدفوعاً» says so, because it is
 * the one action here that cannot be undone: it debits the revenue accounts and credits
 * `safra_payout`, and a ledger movement is not a thing a screen can take back.
 *
 * ## Every row carries where it went and what it moved
 *
 * The destination (masked) and the ledger group id. «Full audit and ledger traceability» is the
 * requirement, and it is met by the row naming both rather than by a link to a screen that would
 * name them.
 */
export function SafraPayouts({ payouts }: { readonly payouts: readonly SafraPayout[] }) {
  const router = useRouter();
  const c = t.sections.treasury;
  const { ask, dialog } = useConfirm();

  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: string, body?: unknown): Promise<void> {
    setBusy(id);
    setError(null);

    try {
      const response = await fetch(`/api/safra-payouts/${id}/${action}`, {
        method: 'POST',
        ...(body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(null);
    }
  }

  const columns: readonly AdminColumn<SafraPayout>[] = [
    {
      key: 'reference',
      header: c.colReference,
      render: (row) => (
        <span className="font-mono text-[11.5px] font-bold text-sky">
          {row.reference}
        </span>
      ),
    },
    {
      key: 'period',
      header: c.colPeriod,
      render: (row) => (
        <span className="text-[11.5px] text-text2">
          {row.periodStart} ← {row.periodEnd}
        </span>
      ),
    },
    {
      key: 'net',
      header: c.colNet,
      render: (row) => (
        <span className="font-bold text-gold tabular-nums">
          {amount(row.netAmount, 'SYP')}
        </span>
      ),
    },
    {
      key: 'destination',
      header: c.colDestination,
      render: (row) =>
        row.accountLabel ? (
          <span className="text-[11.5px] text-text2">
            {row.accountLabel} ····{row.accountLast4}
          </span>
        ) : (
          /* Stated rather than blank: no destination is why a transfer cannot be paid. */
          <span className="text-[11.5px] text-warn">{c.noDestination}</span>
        ),
    },
    {
      key: 'status',
      header: c.colStatus,
      render: (row) => (
        <StatusPill tone={statusTone(row.status)}>
          {label(t.enums.payoutStatus, row.status)}
        </StatusPill>
      ),
    },
    {
      key: 'paid',
      header: c.colPaidAt,
      render: (row) => (
        <span className="text-[11px] text-faint">
          {row.paidAt ? row.paidAt.slice(0, 10) : '—'}
          {row.paidReference ? ` · ${row.paidReference}` : ''}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t.sections.geo.edit,
      render: (row) => (
        <Transitions
          payout={row}
          busy={busy === row.id}
          onAct={(action, body) => void act(row.id, action, body)}
          ask={ask}
        />
      ),
    },
  ];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-[14.5px] font-extrabold text-gold">{c.payoutsTitle}</h2>
        <span className="ms-auto">
          <button
            type="button"
            data-safra-payout-open
            aria-expanded={opening}
            onClick={() => setOpening(!opening)}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.payoutOpen}
          </button>
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-faint">{c.payoutsNote}</p>

      {error ? (
        <p role="alert" className="text-[12px] font-semibold text-bad">
          {error}
        </p>
      ) : null}

      {opening ? <OpenPayout onClose={() => setOpening(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...payouts]}
        template={TEMPLATE}
        rowKey={(row) => row.id}
        minWidth={980}
        empty={c.payoutsEmpty}
      />

      {/* The ledger group behind each paid transfer — traceability, on the row that claims it. */}
      {payouts.some((one) => one.entryGroupId) ? (
        <ul className="grid gap-1">
          {payouts
            .filter((one) => one.entryGroupId)
            .map((one) => (
              <li key={one.id} className="text-[10.5px] text-faint2">
                <span className="font-mono">{one.reference}</span> · {c.entryGroup}:{' '}
                <span className="font-mono" data-entry-group={one.reference}>
                  {one.entryGroupId}
                </span>
              </li>
            ))}
        </ul>
      ) : null}

      {dialog}
    </section>
  );
}

/**
 * What may be done to one transfer, from where it is.
 *
 * A control that cannot complete is not offered. «تسجيل مدفوعاً» appears only on a released
 * transfer with a destination, because the API refuses it otherwise — and a button that always
 * fails is the defect this whole review keeps finding, one door further in.
 */
function Transitions({
  payout,
  busy,
  onAct,
  ask,
}: {
  readonly payout: SafraPayout;
  readonly busy: boolean;
  readonly onAct: (action: string, body?: unknown) => void;
  readonly ask: (request: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    tone?: 'danger';
  }) => Promise<boolean>;
}) {
  const c = t.sections.treasury;
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState('');

  const final = payout.status === 'paid' || payout.status === 'cancelled';

  if (final) return <span className="text-[11px] text-faint2">—</span>;

  if (paying) {
    return (
      <span className="flex flex-wrap items-end gap-2">
        <span className="min-w-[10rem] flex-1">
          <Field label={c.paidReference} value={reference} onChange={setReference} />
        </span>
        <button
          type="button"
          disabled={busy || reference.trim().length < 3}
          data-safra-payout-paid-confirm={payout.id}
          onClick={() => {
            void (async () => {
              const go = await ask({
                title: c.markPaidTitle,
                message: c.markPaidBody,
                confirmLabel: t.sections.dialog.confirm,
                cancelLabel: t.sections.dialog.cancel,
              });

              if (go) onAct('paid', { paidReference: reference.trim() });
            })();
          }}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-ok px-3 py-1.5 text-[11px] font-bold text-bg disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {c.markPaid}
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap gap-1.5">
      {payout.status === 'pending_release' || payout.status === 'on_hold' ? (
        <Small
          label={c.release}
          marker={`data-safra-payout-release`}
          id={payout.id}
          busy={busy}
          onClick={() => onAct('release')}
        />
      ) : null}

      {payout.status === 'scheduled' ? (
        <Small
          label={c.markPaid}
          marker="data-safra-payout-paid"
          id={payout.id}
          busy={busy}
          onClick={() => setPaying(true)}
        />
      ) : null}
    </span>
  );
}

function Small({
  label,
  marker,
  id,
  busy,
  onClick,
}: {
  readonly label: string;
  readonly marker: string;
  readonly id: string;
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      {...{ [marker]: id }}
      onClick={onClick}
      className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
    >
      {label}
    </button>
  );
}

function OpenPayout({ onClose }: { readonly onClose: () => void }) {
  const router = useRouter();
  const c = t.sections.treasury;

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/safra-payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: from,
          periodEnd: to,
          ...(notes ? { notes } : {}),
        }),
      });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)) ?? c.openFailed);

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
    <Panel heading={c.payoutOpenTitle} marker="open" attribute="data-safra-payout-form">
      <Row>
        {/*
          No `dir` override. A field a person types into follows the page, which here is RTL, and
          an ISO date is a left-to-right RUN the bidi algorithm lays out correctly inside it.
        */}
        <Field label={c.periodStart} value={from} onChange={setFrom} hint="YYYY-MM-DD" />
        <Field label={c.periodEnd} value={to} onChange={setTo} hint="YYYY-MM-DD" />
      </Row>
      <Row>
        <Field label={c.notes} value={notes} onChange={setNotes} />
        <span />
      </Row>

      <Actions
        busy={busy}
        error={error}
        ready={/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)}
        saveLabel={t.sections.geo.create}
        busyLabel={t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        onSave={() => void send()}
        onClose={onClose}
      />
    </Panel>
  );
}
