'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { preferredCurrency } from '@safra/contracts';
import { Modal, useConfirm } from '@safra/ui';

import {
  Actions,
  CheckboxField,
  Field,
  Panel,
  Row,
  SelectField,
} from '@/components/geo-form';
import type { Geography } from '@/lib/api';
import { t, apiErrorOf, fill } from '@/lib/strings';

type Country = Geography['countries'][number];
type Currency = Geography['currencies'][number];

/**
 * Editing a country and editing a currency — the two writes the console could not reach.
 *
 * ## The gap
 *
 * `PATCH /admin/geo/countries/:code` and `/currencies/:code` shipped with the geography writes on
 * 2026-08-30, behind `GEO_MANAGE`, with proxy routes in this app — and NOTHING CALLED THEM. Both
 * lists were create-and-read: a country's display currency could be set once and never corrected,
 * a market could be opened and not closed. That is the «built and connected to nothing» shape this
 * codebase keeps producing, and Bashar asked for the full CRUD on both tables.
 *
 * ## Deactivating is the D
 *
 * There is no delete, here or anywhere in geography: a country, a city and a currency are pointed
 * at by bookings, properties and ledger rows that outlive any decision to stop selling somewhere.
 * `isActive` is how the platform withdraws an offer — the row stays, everything already priced in
 * it still reads, and the public search stops offering it. Both confirmations say what that costs.
 */
export function CountryRows({
  rows,
  currencies,
}: {
  readonly rows: readonly Country[];
  /** Codes that are live — a country cannot be pointed at a currency the platform withdrew. */
  readonly currencies: readonly string[];
}) {
  const c = t.sections.geo;
  const [editing, setEditing] = useState<string | null>(null);

  const open = rows.find((one) => one.code === editing) ?? null;

  return (
    <>
      <ul className="grid gap-2 text-[14px]">
        {rows.map((row) => (
          <li
            key={row.code}
            className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-field px-3 py-2.5"
          >
            <span className="font-bold text-text">{row.nameAr}</span>
            <span className="text-[13px] text-faint">
              {row.currencyCode ?? t.admin.noData} ·{' '}
              {fill(c.activeCitiesShort, { n: String(row.activeCities) })}
            </span>
            <span className="ms-auto flex items-center gap-2">
              <span
                className={`text-[13px] font-bold ${row.isActive ? 'text-ok' : 'text-faint'}`}
              >
                {row.isActive ? c.active : c.inactive}
              </span>
              <button
                type="button"
                data-country-edit={row.code}
                onClick={() => setEditing(editing === row.code ? null : row.code)}
                className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold-read"
              >
                {c.edit}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {/* Keyed, so opening a second country re-initialises the fields from ITS props. */}
      {open ? (
        <CountryForm
          key={open.code}
          country={open}
          currencies={currencies}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function CountryForm({
  country,
  currencies,
  onClose,
}: {
  readonly country: Country;
  readonly currencies: readonly string[];
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.geo;
  const { ask, dialog } = useConfirm();

  const [nameAr, setNameAr] = useState(country.nameAr);
  const [nameEn, setNameEn] = useState(country.nameEn);
  const [nameDe, setNameDe] = useState(country.nameDe);
  /* Its own currency, or the platform's standard one — never whichever happens to be first. */
  const [currency, setCurrency] = useState(
    country.currencyCode ?? preferredCurrency(currencies),
  );
  const [launch, setLaunch] = useState(country.isLaunchMarket);
  const [isActive, setIsActive] = useState(country.isActive);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    /* Closing a market removes its cities from the public search; re-opening puts them back. */
    if (!isActive && country.isActive) {
      const go = await ask({
        title: c.closeCountryTitle,
        message: fill(c.closeCountryBody, { n: String(country.activeCities) }),
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
        `/api/geo/countries/${encodeURIComponent(country.code)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nameAr,
            nameEn,
            nameDe,
            displayCurrencyCode: currency,
            isLaunchMarket: launch,
            isActive,
          }),
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

  /**
   * Removes the row, once somebody has confirmed what that costs.
   *
   * The refusal is the interesting path: the API answers a coded 409 naming how many records are
   * holding the row, and `apiErrorOf` resolves it to «لا يمكن حذف … — أوقفها بدل حذفها». That
   * sentence is the whole reason the control is offered rather than hidden — a person who cannot
   * delete a city needs to learn WHY and what to do instead, and a missing button teaches neither.
   */
  async function remove(): Promise<void> {
    const go = await ask({
      title: c.deleteCountryTitle,
      message: c.deleteCountryBody,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/geo/countries/${encodeURIComponent(country.code)}`,
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
    /*
      A POPUP, not a panel under the list (Bashar, 2026-08-30). Editing one row of a list is a
      focused act on that row, and a form that opens underneath pushes everything below it down —
      the reader loses their place in the very list they were working through. `Modal` owns Escape,
      the backdrop, the focus trap and the scroll lock.
    */
    <Modal
      title={`${c.editCountry} — ${country.nameAr}`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <Panel
        heading={`${c.editCountry} — ${country.nameAr}`}
        marker={country.code}
        attribute="data-country-form"
        bare
      >
        <Row>
          <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
          <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
          <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
        </Row>

        <Row>
          {/*
          A SELECT of LIVE currencies. A country priced in one the platform withdrew renders every
          listing in it with a currency nobody can pay — the API refuses it, and free text would
          make that refusal the operator's first discovery of the rule.
        */}
          <SelectField
            label={c.currency}
            name="displayCurrencyCode"
            value={currency}
            onChange={setCurrency}
          >
            {currencies.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </SelectField>
        </Row>

        <CheckboxField label={c.launchMarket} checked={launch} onChange={setLaunch} />
        <CheckboxField
          label={c.countryActive}
          checked={isActive}
          onChange={setIsActive}
        />

        <Actions
          busy={busy}
          ready={nameAr !== '' && currency !== ''}
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
 * The currencies the platform offers — as INFORMATION, not as a control.
 *
 * Bashar, 2026-09-15: «disable this card and hide the edit button… keep it just as an information».
 *
 * There is one currency and there is no rate left to set, so everything this panel could DO has
 * been taken away from it: no «إضافة عملة», no «تعديل», no editor. What remains is a statement of
 * fact, which is the whole of its job now.
 *
 * `CurrencyForm` below is deliberately kept rather than deleted. It is the only screen that can
 * name, activate or withdraw a currency, and the endpoints behind it are live — a panel is easy to
 * give back, an editor rebuilt from nothing is not.
 */
export function CurrencyRows({ rows }: { readonly rows: readonly Currency[] }) {
  const c = t.sections.geo;

  return (
    <>
      <ul className="grid gap-2 text-[14px]">
        {rows.map((row) => (
          <li
            key={row.code}
            className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-field px-3 py-2.5"
          >
            <span className="font-bold text-text">
              {row.nameAr} {row.symbol}
            </span>

            {row.isAccounting ? (
              <span className="rounded-full bg-[rgba(var(--goldA),0.14)] px-2.5 py-0.5 text-[13px] font-extrabold text-gold-read">
                {c.accounting}
              </span>
            ) : null}

            {/* State, because a currency can be withdrawn now — see `CountryRows`. */}
            {row.isActive ? null : (
              <span className="text-[13px] font-bold text-faint">{c.inactive}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
