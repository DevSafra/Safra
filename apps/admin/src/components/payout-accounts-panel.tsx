'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CURRENCY_CATALOGUE, PAYOUT_METHODS, preferredCurrency } from '@safra/contracts';
import { useConfirm } from '@safra/ui';

import { Ltr, StatusPill } from '@/components/admin-table';
import { Actions, Field, Row, SelectField } from '@/components/geo-form';
import type { PayoutAccount } from '@/lib/api';
import { shortDateTime } from '@/lib/format';
import { statusTone } from '@/lib/status-tone';
import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * حسابات التحويل — where a partner's money goes, entered here and approved here (§11.4).
 *
 * Bashar's decision, 2026-09-04: staff may «enter or update payout-account details on behalf of
 * the partner … when required», «the verification state must be clearly visible», and the console
 * «should display appropriately masked account details by default».
 *
 * ## Masked is not a display choice
 *
 * The full account number is not on this screen because it is not in the RESPONSE. The API's read
 * projection never selects the ciphertext, so there is no control here that could reveal it and no
 * permission that would. Staff verify that an account LOOKS like the right business — the holder,
 * the bank, the last four against the partner's documents — and none of that needs the number.
 *
 * The one consequence worth stating: editing an account means retyping the number in full, because
 * the form cannot pre-fill what it was never sent. That is the correct trade. A form that could
 * pre-fill it would be a form that had it.
 *
 * ## Every action is a confirmation, and the destructive ones say so
 *
 * Verifying makes a partner's payouts releasable, and rejecting sends the partner back to a form.
 * Both are `useConfirm()` rather than an immediate write, because both are read by somebody else
 * afterwards — and the rejection dialog collects the REASON, since a refusal with no reason leaves
 * the partner resubmitting the same details.
 */
export function PayoutAccountsPanel({
  reference,
  accounts,
}: {
  readonly reference: string;
  readonly accounts: readonly PayoutAccount[];
}) {
  const router = useRouter();
  const c = t.sections.payoutAccounts;
  const { ask, dialog } = useConfirm();

  /* `null` = nothing open, `'new'` = the add form, an id = that row's edit form. */
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body: unknown,
    ok: string,
  ): Promise<boolean> {
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
        setError(apiErrorOf(await response.json().catch(() => null)));

        return false;
      }

      setNotice(ok);
      setOpen(null);
      router.refresh();

      return true;
    } catch {
      setError(t.errors.unreachable);

      return false;
    } finally {
      setBusy(false);
    }
  }

  async function verify(account: PayoutAccount) {
    const confirmed = await ask({
      title: c.confirmVerify.title,
      message: c.confirmVerify.message,
      confirmLabel: c.confirmVerify.confirm,
      cancelLabel: c.confirmVerify.cancel,
    });

    if (!confirmed) return;

    await send(`/api/payout-accounts/${account.id}/verify`, 'POST', {}, c.verified);
  }

  async function remove(account: PayoutAccount) {
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
    <div data-payout-accounts={reference} className="grid gap-4">
      <p className="text-[12px] leading-relaxed text-faint2">{c.intro}</p>
      {/*
        Separation of duties as guidance, shown where the verifying happens. The platform records
        both actors and does not refuse — so this asks, where a second person is available, rather
        than describing a control that does not exist.
      */}
      <p className="text-[11.5px] leading-relaxed text-muted">{c.ownSubmissionNote}</p>

      {accounts.length === 0 && open !== 'new' ? (
        <p className="text-[12.5px] text-faint">{c.empty}</p>
      ) : null}

      <ul className="grid gap-3">
        {accounts.map((account) => (
          <li
            key={account.id}
            data-payout-account={account.id}
            className="grid gap-2 rounded-lg border border-line bg-panel2 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={statusTone(account.status)}>
                {t.enums.payoutAccountStatus[account.status] ?? account.status}
              </StatusPill>
              {account.isPrimary ? (
                <span className="text-[11.5px] font-semibold text-ok">{c.primary}</span>
              ) : null}
              <span className="text-[11.5px] text-muted">
                {account.submittedByPartner ? c.submittedByPartner : c.submittedByStaff}
              </span>
            </div>

            <div className="text-[13px] leading-relaxed">
              <div className="font-semibold">{account.accountHolder}</div>
              <div className="text-faint2">
                {c.methods[account.method] ?? account.method}
                {account.bankName ? ` · ${account.bankName}` : ''}
                {' · '}
                {/*
                  The mask, and `last4` may legitimately be empty — a wallet number shorter than
                  four characters has no safe tail to show. Printing the dots alone is the honest
                  answer there; printing the whole number would be the leak.
                */}
                <Ltr>{account.last4 === '' ? '••••' : `••••${account.last4}`}</Ltr>
                {' · '}
                {account.currency}
              </div>
              {account.status === 'verified' && account.verifiedAt !== null ? (
                <div className="text-[11.5px] text-muted">
                  {fill(c.verifiedOn, { date: shortDateTime(account.verifiedAt) })}
                </div>
              ) : null}
              {account.status === 'rejected' ? (
                <div className="text-[11.5px] text-bad">
                  {account.rejectedAt === null
                    ? c.rejectionReason
                    : fill(c.rejectedOn, { date: shortDateTime(account.rejectedAt) })}
                  {account.rejectionReason ? ` — ${account.rejectionReason}` : ''}
                </div>
              ) : null}
            </div>

            {open === account.id ? (
              <AccountForm
                account={account}
                busy={busy}
                error={error}
                onCancel={() => {
                  setOpen(null);
                  setError(null);
                }}
                onSave={(body) =>
                  send(`/api/payout-accounts/${account.id}`, 'PUT', body, c.saved)
                }
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {account.status === 'pending' ? (
                  <>
                    <Action
                      label={c.verify}
                      onClick={() => void verify(account)}
                      busy={busy}
                    />
                    <Rejection
                      account={account}
                      busy={busy}
                      onReject={(reason) =>
                        send(
                          `/api/payout-accounts/${account.id}/reject`,
                          'POST',
                          { reason },
                          c.rejected,
                        )
                      }
                    />
                  </>
                ) : null}
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
          onSave={(body) =>
            send(
              `/api/partners/${encodeURIComponent(reference)}/payout-accounts`,
              'POST',
              body,
              c.saved,
            )
          }
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

      {notice ? <p className="text-[11.5px] font-semibold text-ok">{notice}</p> : null}
      {error && open === null ? (
        <p className="text-[11.5px] font-semibold text-bad">{error}</p>
      ) : null}

      {dialog}
    </div>
  );
}

/**
 * The form, shared by "add" and "edit".
 *
 * The account number starts EMPTY on an edit, because the console is never sent it. The label says
 * so through the field's own hint rather than through a placeholder somebody might mistake for a
 * value.
 */
function AccountForm({
  account,
  busy,
  error,
  onSave,
  onCancel,
}: {
  readonly account: PayoutAccount | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSave: (body: Record<string, string>) => Promise<boolean>;
  readonly onCancel: () => void;
}) {
  const c = t.sections.payoutAccounts;
  const [method, setMethod] = useState(account?.method ?? PAYOUT_METHODS[0]);
  const [holder, setHolder] = useState(account?.accountHolder ?? '');
  const [number, setNumber] = useState('');
  const [bank, setBank] = useState(account?.bankName ?? '');
  const [swift, setSwift] = useState(account?.swiftCode ?? '');
  /* The platform's standard currency — the same rule the partner's own form follows. */
  const [currency, setCurrency] = useState(
    account?.currency ?? preferredCurrency(CURRENCY_CATALOGUE.map((one) => one.code)),
  );

  const ready = holder.trim().length >= 2 && number.trim().length >= 4;

  return (
    <div className="grid gap-3 border-t border-line pt-3">
      <Row>
        <SelectField
          label={c.fields.method}
          value={method}
          onChange={setMethod}
          name="method"
        >
          {PAYOUT_METHODS.map((one) => (
            <option key={one} value={one}>
              {c.methods[one] ?? one}
            </option>
          ))}
        </SelectField>
        <Field
          label={c.fields.accountHolder}
          name="accountHolder"
          value={holder}
          onChange={setHolder}
        />
        {/*
          No `dir="ltr"`. An IBAN is a left-to-right RUN and the bidi algorithm lays it out
          correctly inside an RTL field on its own; `dir="ltr"` would also move the field's start
          edge, putting the caret on the wrong side of its own label.
        */}
        <Field
          label={c.fields.accountNumber}
          name="accountNumber"
          value={number}
          onChange={setNumber}
        />
      </Row>
      <Row>
        <Field
          label={c.fields.bankName}
          name="bankName"
          value={bank}
          onChange={setBank}
        />
        <Field
          label={c.fields.swiftCode}
          name="swiftCode"
          value={swift}
          onChange={setSwift}
        />
        <SelectField
          label={c.fields.currency}
          value={currency}
          onChange={setCurrency}
          name="currency"
        >
          {CURRENCY_CATALOGUE.map((one) => (
            <option key={one.code} value={one.code}>
              {one.nameAr} ({one.code})
            </option>
          ))}
        </SelectField>
      </Row>

      <Actions
        busy={busy}
        ready={ready}
        error={error}
        saveLabel={c.save}
        busyLabel={t.sections.geo.saving}
        cancelLabel={c.cancel}
        onSave={() => {
          void onSave({
            method,
            accountHolder: holder,
            accountNumber: number,
            bankName: bank,
            swiftCode: swift,
            currency,
          });
        }}
        onClose={onCancel}
      />
    </div>
  );
}

/** Rejecting needs a reason, so it opens a field rather than firing on the press. */
function Rejection({
  account,
  busy,
  onReject,
}: {
  readonly account: PayoutAccount;
  readonly busy: boolean;
  readonly onReject: (reason: string) => Promise<boolean>;
}) {
  const c = t.sections.payoutAccounts.rejectDialog;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <Action
        label={t.sections.payoutAccounts.reject}
        onClick={() => setOpen(true)}
        busy={busy}
        danger
      />
    );
  }

  return (
    <div data-reject-account={account.id} className="grid w-full gap-2">
      <p className="text-[11.5px] text-faint2">{c.message}</p>
      <Field label={c.reason} name="reason" value={reason} onChange={setReason} />
      <div className="flex gap-2">
        <Action
          label={c.confirm}
          onClick={() => {
            void onReject(reason);
          }}
          busy={busy || reason.trim().length < 8}
          danger
        />
        <Action
          label={c.cancel}
          onClick={() => {
            setOpen(false);
            setReason('');
          }}
          busy={busy}
        />
      </div>
    </div>
  );
}

/** One control, one look — so eight buttons on this panel do not become eight decisions. */
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
      className={`inline-flex min-h-10 cursor-pointer items-center rounded-md border px-3 text-[12.5px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-1.5 ${
        danger
          ? 'border-bad/40 text-bad hover:bg-bad/10'
          : 'border-line text-text hover:bg-panel2'
      }`}
    >
      {label}
    </button>
  );
}
