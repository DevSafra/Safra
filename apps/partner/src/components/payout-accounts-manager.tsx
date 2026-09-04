'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CURRENCY_CATALOGUE, PAYOUT_METHODS } from '@safra/contracts';
import { statusTone, useConfirm } from '@safra/ui';
import { errorMessage } from '@safra/i18n';

import { Ltr } from '@/components/ltr';
import type { PartnerPayoutAccount } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';
import { TONES } from '@/lib/tones';

/**
 * حسابات التحويل — a partner setting up and correcting where their money arrives.
 *
 * Bashar's decision, 2026-09-04: «The partner can enter and maintain their own payout-account
 * details through the Partner Portal», and «Every new payout account and every material change
 * must require verification before it becomes eligible for payouts».
 *
 * ## The consequence is stated BEFORE the edit, not after
 *
 * `editWarning` sits above the form rather than appearing as a toast afterwards. A partner who
 * corrects a typo in their bank name and discovers a day later that their transfer stopped has
 * been surprised by a rule nobody told them about; the same sentence, one screen earlier, is the
 * difference between a control and a trap.
 *
 * ## The number is not shown back, not even to its owner
 *
 * The API never sends it, so editing means retyping it. That is deliberate and it applies here for
 * a reason it does not apply in the console: a partner's session on a shared reception machine is
 * the ordinary case, not the exceptional one, and a screen that prints a full IBAN on load is a
 * screen anybody who walks past has read.
 */
export function PayoutAccountsManager({
  accounts,
}: {
  readonly accounts: readonly PartnerPayoutAccount[];
}) {
  const router = useRouter();
  const c = t.payoutAccounts;
  const { ask, dialog } = useConfirm();

  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body: unknown,
    ok: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });

      if (!response.ok) {
        /*
          The API's own sentence when it has one, `refusalFor` first for the suspension case, and
          this screen's generic last. A validation refusal here is actionable — «رقم الحساب يجب أن
          يتكوّن من ٤ إلى ٣٤ حرفاً» tells the partner which field to fix — and collapsing it to
          «تعذّر الحفظ» would send them to support for something they can correct themselves.
        */
        const code = await codeOfResponse(response);

        setError(
          refusalFor(code) ??
            (typeof code === 'string' ? errorMessage(code, 'ar') : c.failed),
        );

        return;
      }

      setNotice(ok);
      setOpen(null);
      router.refresh();
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: PartnerPayoutAccount) {
    const confirmed = await ask({
      title: c.confirmRemove.title,
      message: c.confirmRemove.message,
      confirmLabel: c.confirmRemove.confirm,
      cancelLabel: c.confirmRemove.cancel,
      tone: 'danger',
    });

    if (!confirmed) return;

    await send(`/api/payout-accounts/${account.id}`, 'DELETE', undefined, c.removed);
  }

  return (
    <div data-payout-accounts className="grid gap-3">
      {accounts.length === 0 && open !== 'new' ? (
        <p className="text-sm text-faint">{c.empty}</p>
      ) : null}

      <ul className="grid gap-2.5">
        {accounts.map((account) => (
          <li
            key={account.id}
            data-payout-account={account.id}
            className="grid gap-2 rounded-lg border border-line bg-panel px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-status-pill
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[statusTone(account.status)]}`}
              >
                {c.status[account.status] ?? account.status}
              </span>
              {account.isPrimary ? (
                <span className="text-[11.5px] font-semibold text-ok">{c.primary}</span>
              ) : null}
            </div>

            <div className="text-[13px] leading-relaxed">
              <div className="font-semibold text-text">{account.accountHolder}</div>
              <div className="text-faint">
                {c.methods[account.method] ?? account.method}
                {account.bankName ? ` · ${account.bankName}` : ''}
                {' · '}
                {c.masked} <Ltr>{account.last4 === '' ? '••••' : account.last4}</Ltr>
                {' · '}
                {account.currency}
              </div>
            </div>

            {/* The state as a SENTENCE, because a pill says what and this says what it means. */}
            <p
              className={`text-[11.5px] leading-relaxed ${
                account.status === 'rejected' ? 'text-bad' : 'text-faint'
              }`}
            >
              {account.status === 'verified'
                ? c.stateVerified
                : account.status === 'rejected'
                  ? c.stateRejected
                  : c.statePending}
            </p>

            {account.status === 'rejected' && account.rejectionReason ? (
              <p className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] leading-relaxed text-text">
                <span className="font-semibold">{c.rejectionReason}: </span>
                {account.rejectionReason}
              </p>
            ) : null}

            {open === account.id ? (
              <AccountForm
                account={account}
                busy={busy}
                error={error}
                onCancel={() => {
                  setOpen(null);
                  setError(null);
                }}
                onSave={(body) => {
                  void send(`/api/payout-accounts/${account.id}`, 'PUT', body, c.saved);
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Action
                  label={c.edit}
                  onClick={() => {
                    setOpen(account.id);
                    setError(null);
                  }}
                  busy={busy}
                />
                <Action
                  label={c.remove}
                  onClick={() => void remove(account)}
                  busy={busy}
                  danger
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {open === 'new' ? (
        <AccountForm
          account={null}
          busy={busy}
          error={error}
          onCancel={() => {
            setOpen(null);
            setError(null);
          }}
          onSave={(body) => {
            void send('/api/payout-accounts', 'POST', body, c.saved);
          }}
        />
      ) : (
        <Action
          label={c.add}
          onClick={() => {
            setOpen('new');
            setError(null);
          }}
          busy={busy}
        />
      )}

      {notice ? <p className="text-[12px] font-semibold text-ok">{notice}</p> : null}
      {error && open === null ? (
        <p role="alert" className="text-[12px] font-semibold text-bad">
          {error}
        </p>
      ) : null}

      {dialog}
    </div>
  );
}

function AccountForm({
  account,
  busy,
  error,
  onSave,
  onCancel,
}: {
  readonly account: PartnerPayoutAccount | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSave: (body: Record<string, string>) => void;
  readonly onCancel: () => void;
}) {
  const c = t.payoutAccounts;
  const [method, setMethod] = useState(account?.method ?? PAYOUT_METHODS[0]);
  const [holder, setHolder] = useState(account?.accountHolder ?? '');
  const [number, setNumber] = useState('');
  const [bank, setBank] = useState(account?.bankName ?? '');
  const [swift, setSwift] = useState(account?.swiftCode ?? '');
  const [currency, setCurrency] = useState(account?.currency ?? 'SYP');

  return (
    <form
      className="grid gap-2.5 border-t border-line pt-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          method,
          accountHolder: holder,
          accountNumber: number,
          bankName: bank,
          swiftCode: swift,
          currency,
        });
      }}
    >
      {/* Said before the edit, not after it — see the note at the top of this file. */}
      <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11.5px] leading-relaxed text-faint">
        {c.editWarning}
      </p>

      <label className="grid gap-1 text-[12.5px] text-muted">
        {c.fields.method}
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          required
          className="cursor-pointer rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        >
          {PAYOUT_METHODS.map((one) => (
            <option key={one} value={one}>
              {c.methods[one] ?? one}
            </option>
          ))}
        </select>
      </label>

      {/*
        No `dir` on any field: a field a person types into follows the page's direction. An IBAN is
        a left-to-right RUN and the bidi algorithm lays it out correctly inside an RTL field.
      */}
      <label className="grid gap-1 text-[12.5px] text-muted">
        {c.fields.accountHolder}
        <input
          type="text"
          value={holder}
          onChange={(event) => setHolder(event.target.value)}
          required
          minLength={2}
          maxLength={120}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        />
      </label>

      <label className="grid gap-1 text-[12.5px] text-muted">
        {c.fields.accountNumber}
        <input
          type="text"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          required
          minLength={4}
          maxLength={40}
          autoComplete="off"
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        />
      </label>

      <label className="grid gap-1 text-[12.5px] text-muted">
        {c.fields.bankName}
        <input
          type="text"
          value={bank}
          onChange={(event) => setBank(event.target.value)}
          maxLength={120}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        />
      </label>

      <label className="grid gap-1 text-[12.5px] text-muted">
        {c.fields.swiftCode}
        <input
          type="text"
          value={swift}
          onChange={(event) => setSwift(event.target.value)}
          maxLength={11}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        />
      </label>

      <label className="grid gap-1 text-[12.5px] text-muted">
        {c.fields.currency}
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          required
          className="cursor-pointer rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        >
          {CURRENCY_CATALOGUE.map((one) => (
            <option key={one.code} value={one.code}>
              {one.nameAr} ({one.code})
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-gold px-4 text-[13px] font-semibold text-ink transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-2"
        >
          {c.save}
        </button>
        <Action label={c.cancel} onClick={onCancel} busy={busy} />
      </div>
    </form>
  );
}

/** One control, one look — so six buttons on this screen do not become six decisions. */
function Action({
  label,
  onClick,
  busy,
  danger,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly busy: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-3 text-[12.5px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-1.5 ${
        danger
          ? 'border-bad/40 text-bad hover:bg-bad/10'
          : 'border-line text-text hover:bg-panel'
      }`}
    >
      {label}
    </button>
  );
}
