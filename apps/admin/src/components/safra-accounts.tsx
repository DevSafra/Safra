'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CURRENCY_CATALOGUE, PAYOUT_METHODS, preferredCurrency } from '@safra/contracts';
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
import type { SafraAccount } from '@/lib/api';
import { count } from '@/lib/format';
import { apiErrorOf, label, t } from '@/lib/strings';

/** Label · holder · bank · last4 · default · active · status · transfers · edit. */
const TEMPLATE = '1fr .9fr .9fr .6fr .5fr .5fr .7fr .5fr .5fr';

/**
 * حسابات تحويل سفرة — where the platform's own money is collected.
 *
 * ## The same protections a partner's account has, because it is the same kind of thing
 *
 * Masked number, `pending` until a human verifies it, a rejection that must carry a reason. What
 * differs is what a SAFRA account needs and a partner's does not: a LABEL, because there is one
 * SAFRA and several of its accounts, and a DEFAULT, because a transfer has to know which.
 *
 * ## Verified and active are separate, and the table shows both
 *
 * Verification is a statement about the account's authenticity; activation is an operational
 * decision. Collapsing them would mean taking an account out of service required un-verifying it,
 * and putting it back required a second verification of something nobody doubted.
 *
 * ## Deleting is refused once a transfer points at it
 *
 * The transfer's own record names the account it went to; removing that row would leave a paid
 * transfer pointing at nothing. The column showing how many transfers used it is what makes
 * «deactivate, do not delete» an informed choice rather than a guess.
 */
export function SafraAccounts({
  accounts,
}: {
  readonly accounts: readonly SafraAccount[];
}) {
  const router = useRouter();
  const c = t.sections.treasury;
  const { ask, dialog } = useConfirm();

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = accounts.find((one) => one.id === editing) ?? null;

  async function act(id: string, action: string, body?: unknown): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/safra-payouts/accounts/${id}/${action}`, {
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
      setBusy(false);
    }
  }

  const columns: readonly AdminColumn<SafraAccount>[] = [
    {
      key: 'label',
      header: c.label,
      render: (row) => <span className="font-semibold text-text">{row.label}</span>,
    },
    {
      key: 'holder',
      header: c.colHolder,
      render: (row) => <span className="text-text2">{row.accountHolder}</span>,
    },
    {
      key: 'bank',
      header: c.colBank,
      render: (row) => <span className="text-text2">{row.bankName ?? '—'}</span>,
    },
    {
      key: 'last4',
      header: c.colLast4,
      /* Masked, and it always was: the API never selects the ciphertext, let alone returns it. */
      render: (row) => (
        <span className="font-mono text-[11.5px] text-faint">····{row.last4}</span>
      ),
    },
    {
      key: 'default',
      header: c.colDefault,
      render: (row) =>
        row.isDefault ? (
          <StatusPill tone="gold">{c.yes}</StatusPill>
        ) : (
          <span className="text-[11px] text-faint2">{c.no}</span>
        ),
    },
    {
      key: 'active',
      header: c.colActive,
      render: (row) => (
        <StatusPill tone={row.isActive ? 'ok' : 'faint'}>
          {row.isActive ? c.yes : c.no}
        </StatusPill>
      ),
    },
    {
      key: 'status',
      header: c.colStatus,
      render: (row) => (
        <StatusPill
          tone={
            row.status === 'verified' ? 'ok' : row.status === 'rejected' ? 'bad' : 'pend'
          }
        >
          {row.status === 'verified'
            ? c.verified
            : row.status === 'rejected'
              ? c.rejected
              : c.pending}
        </StatusPill>
      ),
    },
    {
      key: 'transfers',
      header: c.colTransfers,
      render: (row) => <span className="text-text2">{count(row.payouts)}</span>,
    },
    {
      key: 'edit',
      header: t.sections.geo.edit,
      render: (row) => (
        <button
          type="button"
          data-safra-account-edit={row.id}
          onClick={() => {
            setAdding(false);
            setEditing(editing === row.id ? null : row.id);
          }}
          className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold"
        >
          {t.sections.geo.edit}
        </button>
      ),
    },
  ];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-[14.5px] font-extrabold text-gold">{c.accountsTitle}</h2>
        <span className="ms-auto">
          <button
            type="button"
            data-safra-account-add
            aria-expanded={adding}
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.accountAdd}
          </button>
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-faint">{c.accountsNote}</p>

      {error ? (
        <p role="alert" className="text-[12px] font-semibold text-bad">
          {error}
        </p>
      ) : null}

      {adding ? <AddAccount onClose={() => setAdding(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...accounts]}
        template={TEMPLATE}
        rowKey={(row) => row.id}
        minWidth={900}
        empty={c.accountsEmpty}
      />

      {open ? (
        <div
          className="grid gap-3 rounded-card border border-line bg-field p-4"
          data-safra-account-panel={open.id}
        >
          <p className="text-[11.5px] font-bold text-gold">{c.accountEditTitle}</p>

          {/* Why it was refused, where the person deciding what to do next is looking. */}
          {open.rejectionReason ? (
            <p className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] leading-relaxed text-text">
              {open.rejectionReason}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {open.status !== 'verified' ? (
              <button
                type="button"
                disabled={busy}
                data-safra-account-verify={open.id}
                onClick={() => {
                  void (async () => {
                    const go = await ask({
                      title: c.verifyTitle,
                      message: c.verifyBody,
                      confirmLabel: t.sections.dialog.confirm,
                      cancelLabel: t.sections.dialog.cancel,
                    });

                    if (go) await act(open.id, 'verify');
                  })();
                }}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-ok px-4 py-2 text-xs font-bold text-bg disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
              >
                {c.verify}
              </button>
            ) : null}

            <RejectAccount
              id={open.id}
              busy={busy}
              onReject={(reason) => {
                void act(open.id, 'reject', { reason });
              }}
            />
          </div>

          <EditAccount
            account={open}
            onClose={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        </div>
      ) : null}

      {dialog}
    </section>
  );
}

/** Rejecting needs a reason, so the control is a small form rather than a button. */
function RejectAccount({
  id,
  busy,
  onReject,
}: {
  readonly id: string;
  readonly busy: boolean;
  readonly onReject: (reason: string) => void;
}) {
  const c = t.sections.treasury;
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        data-safra-account-reject={id}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-xs text-muted transition-colors hover:border-bad/50 hover:text-bad disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {c.reject}
      </button>
    );
  }

  return (
    <span className="flex w-full flex-wrap items-end gap-2">
      <span className="min-w-[16rem] flex-1">
        <Field label={c.rejectReason} value={reason} onChange={setReason} />
      </span>
      <button
        type="button"
        disabled={busy || reason.trim().length < 8}
        data-safra-account-reject-confirm={id}
        onClick={() => onReject(reason.trim())}
        className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-bad px-4 py-2 text-xs font-bold text-bg disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {c.reject}
      </button>
    </span>
  );
}

function AddAccount({ onClose }: { readonly onClose: () => void }) {
  const router = useRouter();
  const c = t.sections.treasury;

  const [form, setForm] = useState({
    label: '',
    method: String(PAYOUT_METHODS[0]),
    accountHolder: '',
    accountNumber: '',
    bankName: '',
    swiftCode: '',
    /*
      The platform's standard currency, and a field rather than a constant.

      This was a hardcoded 'SYP' with no control beside it, so a SAFRA destination could only ever
      be recorded as Syrian pounds — a dollar account was not expressible. It is what the account
      is DENOMINATED in, which is a fact about the bank rather than about the ledger: transfers are
      still posted in the accounting currency, so opening this up changes what an operator can
      describe and nothing about what is counted.
    */
    currency: preferredCurrency(CURRENCY_CATALOGUE.map((one) => one.code)),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/safra-payouts/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label,
          method: form.method,
          accountHolder: form.accountHolder,
          accountNumber: form.accountNumber,
          /* Omitted rather than sent empty: the API stores null for «not given». */
          ...(form.bankName ? { bankName: form.bankName } : {}),
          ...(form.swiftCode ? { swiftCode: form.swiftCode } : {}),
          currency: form.currency,
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
    <Panel heading={c.accountAddTitle} marker="add" attribute="data-safra-account-form">
      <Row>
        <Field
          label={c.label}
          value={form.label}
          onChange={set('label')}
          hint={c.labelHint}
        />
        <SelectField label={c.method} value={form.method} onChange={set('method')}>
          {PAYOUT_METHODS.map((one) => (
            <option key={one} value={one}>
              {label(t.enums.payoutMethod, one)}
            </option>
          ))}
        </SelectField>
      </Row>
      <Row>
        <Field
          label={c.accountHolder}
          value={form.accountHolder}
          onChange={set('accountHolder')}
        />
        <Field
          label={c.accountNumber}
          value={form.accountNumber}
          onChange={set('accountNumber')}
          hint={c.accountNumberHint}
        />
      </Row>
      <Row>
        <Field label={c.bankName} value={form.bankName} onChange={set('bankName')} />
        <Field label={c.swiftCode} value={form.swiftCode} onChange={set('swiftCode')} />
      </Row>
      <Row>
        <SelectField label={c.currency} value={form.currency} onChange={set('currency')}>
          {CURRENCY_CATALOGUE.map((one) => (
            <option key={one.code} value={one.code}>
              {one.nameAr} ({one.code})
            </option>
          ))}
        </SelectField>
        <span />
      </Row>

      <Actions
        busy={busy}
        error={error}
        ready={
          form.label !== '' && form.accountHolder !== '' && form.accountNumber.length >= 4
        }
        saveLabel={t.sections.geo.create}
        busyLabel={t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        onSave={() => void send()}
        onClose={onClose}
      />
    </Panel>
  );
}

function EditAccount({
  account,
  onClose,
}: {
  readonly account: SafraAccount;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.treasury;
  const { ask, dialog } = useConfirm();

  const [label_, setLabel] = useState(account.label);
  const [holder, setHolder] = useState(account.accountHolder);
  const [bank, setBank] = useState(account.bankName ?? '');
  const [isDefault, setDefault] = useState(account.isDefault);
  const [isActive, setActive] = useState(account.isActive);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    /* Taking a destination out of service is the consequential act, so it is confirmed. */
    if (account.isActive && !isActive) {
      const go = await ask({
        title: c.deactivateTitle,
        message: c.deactivateBody,
        confirmLabel: t.sections.dialog.confirm,
        cancelLabel: t.sections.dialog.cancel,
      });

      if (!go) return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/safra-payouts/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label_,
          accountHolder: holder,
          ...(bank ? { bankName: bank } : {}),
          isDefault,
          isActive,
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

  async function remove(): Promise<void> {
    const go = await ask({
      title: c.deleteAccountTitle,
      message: c.deleteAccountBody,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/safra-payouts/accounts/${account.id}`, {
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
    <>
      <Row>
        <Field label={c.label} value={label_} onChange={setLabel} />
        <Field label={c.accountHolder} value={holder} onChange={setHolder} />
      </Row>
      <Row>
        <Field label={c.bankName} value={bank} onChange={setBank} />
        <span />
      </Row>

      {/*
        Offered only on a VERIFIED account. Making an unverified one the default would create a
        destination a transfer picks up and then refuses to pay into — a control that appears to
        work and cannot complete, which is the class of defect this whole review keeps finding.
      */}
      {account.status === 'verified' ? (
        <CheckboxField label={c.isDefault} checked={isDefault} onChange={setDefault} />
      ) : null}

      <CheckboxField label={c.isActive} checked={isActive} onChange={setActive} />

      <Actions
        busy={busy}
        deleting={deleting}
        error={error}
        ready
        saveLabel={t.sections.geo.save}
        busyLabel={t.sections.geo.saving}
        cancelLabel={t.sections.geo.cancel}
        deleteLabel={c.remove}
        deletingLabel={t.sections.geo.saving}
        onDelete={() => void remove()}
        onSave={() => void save()}
        onClose={onClose}
      />

      {dialog}
    </>
  );
}
