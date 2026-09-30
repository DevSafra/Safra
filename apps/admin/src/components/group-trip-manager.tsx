'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { GROUP_TRIP_STATUSES } from '@safra/contracts';
import { statusTone, useConfirm } from '@safra/ui';

import { AddButton } from '@/components/add-button';
import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { Actions, Field, Panel, Prose, Row, SelectField } from '@/components/geo-form';
import { TablePagination } from '@/components/table-pagination';
import type { GroupTripRow } from '@/lib/api';
import { amount, dateRange } from '@/lib/format';
import { apiErrorOf, label, t } from '@/lib/strings';

/**
 * جروبات — the console's registry of announced trips (Bashar, 2026-09-27).
 *
 * ## Paged like every other registry
 *
 * Numbered pages, a size control and the bar directly under the table. Trips accumulate with time
 * rather than being bounded by the business, so this is not the geography exception — it is an
 * ordinary registry and it pages like one.
 *
 * ## The price never appears without its currency
 *
 * `amount(value, currency)` and nothing else. The pair is null together — the database has a CHECK
 * constraint saying so — and the column prints «عند الطلب» rather than a bare figure when it is.
 * «٤٥٠» with no currency is not a smaller version of the right answer.
 */
/**
 * The select's «no currency chosen» value, which the contract reads back as `null`.
 *
 * Named rather than coerced inline at the call site, and not only to satisfy
 * `no-bare-amounts.test.ts` — that sweep is right that an empty-string currency fallback is worth
 * a second look. Here the empty is a legitimate FORM state («السعر عند الطلب»), not a missing
 * currency
 * beside a rendered figure, and a name is what says so. No amount is ever rendered from it: the
 * table prints «عند الطلب» when the pair is absent.
 */
const NO_CURRENCY = '';

export type TripWithCover = GroupTripRow & { readonly coverUrl: string | null };

export function GroupTripManager({
  trips,
  cities,
  currencies,
  page,
  pages,
  total,
  capped,
  size,
}: {
  /*
    `coverUrl` is resolved by the PAGE, server-side. A client component cannot build it: it would
    read `NEXT_PUBLIC_MEDIA_URL` from a build-time inline, which is empty in any console built
    without that variable and silently 404s every preview.
  */
  readonly trips: readonly TripWithCover[];
  readonly cities: readonly { readonly slug: string; readonly nameAr: string }[];
  readonly currencies: readonly { readonly code: string }[];
  readonly page: number;
  readonly pages: number;
  readonly total: number;
  readonly capped: boolean;
  readonly size: number;
}) {
  const c = t.sections.groupTrips;

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const open = trips.find((one) => one.slug === editing) ?? null;

  const columns: readonly AdminColumn<GroupTripRow>[] = [
    {
      key: 'title',
      header: c.colTitle,
      render: (row) => <span className="font-semibold text-text">{row.titleAr}</span>,
    },
    {
      key: 'city',
      header: c.colCity,
      render: (row) => <span className="text-text2">{row.cityNameAr}</span>,
    },
    {
      key: 'dates',
      header: c.colDates,
      render: (row) => (
        <span className="text-text2">{dateRange(row.startsOn, row.endsOn)}</span>
      ),
    },
    {
      key: 'price',
      header: c.colPrice,
      render: (row) => (
        <span className="text-text2">
          {row.priceFrom && row.currencyCode
            ? amount(row.priceFrom, row.currencyCode)
            : c.onRequest}
        </span>
      ),
    },
    {
      key: 'seats',
      header: c.colSeats,
      render: (row) => <span className="text-text2">{row.seats ?? '—'}</span>,
    },
    {
      key: 'status',
      header: c.colStatus,
      render: (row) => (
        <StatusPill tone={statusTone(row.status)}>
          {label(t.enums.groupTripStatus, row.status)}
        </StatusPill>
      ),
    },
    {
      key: 'edit',
      header: c.edit,
      render: (row) => (
        <button
          type="button"
          data-group-trip-edit={row.slug}
          onClick={() => {
            setAdding(false);
            setEditing(editing === row.slug ? null : row.slug);
          }}
          className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-13 text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold-read"
        >
          {c.edit}
        </button>
      ),
    },
  ];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-16 font-extrabold text-gold-read">{c.title}</h2>
        <span className="ms-auto">
          <AddButton
            label={c.add}
            expanded={adding}
            attribute="data-group-trip-add"
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
          />
        </span>
      </div>

      <p className="text-13 leading-relaxed text-faint">{c.note}</p>

      {adding ? (
        <GroupTripForm
          cities={cities}
          currencies={currencies}
          onClose={() => setAdding(false)}
        />
      ) : null}

      <AdminTable
        columns={columns}
        rows={[...trips]}
        template="1.2fr .6fr .8fr .6fr .4fr .5fr .4fr"
        rowKey={(row) => row.slug}
        minWidth={900}
        empty={c.empty}
      />

      {/* Directly UNDER the table, which is where this bar is specified to sit. */}
      <TablePagination
        basePath="/groups"
        section="groupTrips"
        query={{}}
        page={page}
        pages={pages}
        total={total}
        capped={capped}
        size={size}
      />

      {open ? (
        <GroupTripForm
          key={open.slug}
          trip={open}
          cities={cities}
          currencies={currencies}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function GroupTripForm({
  trip,
  cities,
  currencies,
  onClose,
}: {
  readonly trip?: TripWithCover | undefined;
  readonly cities: readonly { readonly slug: string; readonly nameAr: string }[];
  readonly currencies: readonly { readonly code: string }[];
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.groupTrips;
  const { ask, dialog } = useConfirm();

  const [slug, setSlug] = useState(trip?.slug ?? '');
  const [citySlug, setCitySlug] = useState(trip?.citySlug ?? cities[0]?.slug ?? '');
  const [titleAr, setTitleAr] = useState(trip?.titleAr ?? '');
  const [titleEn, setTitleEn] = useState(trip?.titleEn ?? '');
  const [titleDe, setTitleDe] = useState(trip?.titleDe ?? '');
  const [summaryAr, setSummaryAr] = useState(trip?.summaryAr ?? '');
  const [summaryEn, setSummaryEn] = useState(trip?.summaryEn ?? '');
  const [summaryDe, setSummaryDe] = useState(trip?.summaryDe ?? '');
  const [descriptionAr, setDescriptionAr] = useState(trip?.descriptionAr ?? '');
  const [descriptionEn, setDescriptionEn] = useState(trip?.descriptionEn ?? '');
  const [descriptionDe, setDescriptionDe] = useState(trip?.descriptionDe ?? '');
  const [startsOn, setStartsOn] = useState(trip?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(trip?.endsOn ?? '');
  const [priceFrom, setPriceFrom] = useState(trip?.priceFrom ?? '');
  const [currencyCode, setCurrencyCode] = useState(trip?.currencyCode ?? NO_CURRENCY);
  const [seats, setSeats] = useState(
    trip?.seats === null || trip === undefined ? '' : String(trip.seats),
  );
  const [status, setStatus] = useState(trip?.status ?? 'draft');
  const [coverAltAr, setCoverAltAr] = useState(trip?.cover?.alt.ar ?? '');
  const [coverAltEn, setCoverAltEn] = useState(trip?.cover?.alt.en ?? '');
  const [coverAltDe, setCoverAltDe] = useState(trip?.cover?.alt.de ?? '');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const body = {
        ...(trip ? {} : { slug }),
        citySlug,
        titleAr,
        titleEn: titleEn || null,
        titleDe: titleDe || null,
        summaryAr,
        summaryEn: summaryEn || null,
        summaryDe: summaryDe || null,
        descriptionAr,
        descriptionEn: descriptionEn || null,
        descriptionDe: descriptionDe || null,
        startsOn,
        endsOn,
        priceFrom: priceFrom || null,
        currencyCode: currencyCode || null,
        seats: seats ? Number(seats) : null,
        ...(trip ? { status } : {}),
        /*
          Only when editing. A create has no row yet, so it can have no cover and therefore no alt
          text — and the create schema does not accept the keys, which `.strict()` would reject.
        */
        ...(trip
          ? {
              coverAltAr: coverAltAr || null,
              coverAltEn: coverAltEn || null,
              coverAltDe: coverAltDe || null,
            }
          : {}),
      };

      const response = await fetch(
        trip ? `/api/group-trips/${encodeURIComponent(trip.slug)}` : '/api/group-trips',
        {
          method: trip ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
   * Uploads the bytes and refreshes, rather than staging them until save.
   *
   * The photograph is not a form FIELD — it is an object in a store with its own endpoint, and
   * holding it in memory until somebody presses «حفظ» would mean a ten-megabyte file lost to a
   * mistyped date. Same shape as the city hero upload, for the same reason.
   */
  async function uploadCover(chosen: File): Promise<void> {
    if (!trip) return;

    setUploading(true);
    setError(null);

    try {
      const body = new FormData();

      body.append('file', chosen);

      const response = await fetch(
        `/api/group-trips/${encodeURIComponent(trip.slug)}/cover`,
        { method: 'POST', body },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setUploading(false);
      /* So choosing the SAME file again still fires a change event. */
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeCover(): Promise<void> {
    if (!trip?.cover) return;

    const go = await ask({
      title: c.coverRemove,
      message: c.coverRemoveConfirm,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setUploading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/group-trips/${encodeURIComponent(trip.slug)}/cover`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setUploading(false);
    }
  }

  async function remove(): Promise<void> {
    if (!trip) return;

    const go = await ask({
      title: c.remove,
      message: c.deleteHint,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/group-trips/${encodeURIComponent(trip.slug)}`, {
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
    <Panel
      heading={trip ? c.editTitle : c.addTitle}
      marker={trip?.slug ?? 'add'}
      attribute="data-group-trip-form"
    >
      <Row>
        {trip ? (
          <Field label={c.slug} value={trip.slug} onChange={() => undefined} disabled />
        ) : (
          <Field label={c.slug} value={slug} onChange={setSlug} hint={c.slugHint} />
        )}
        <SelectField label={c.city} value={citySlug} onChange={setCitySlug}>
          {cities.map((city) => (
            <option key={city.slug} value={city.slug}>
              {city.nameAr}
            </option>
          ))}
        </SelectField>
      </Row>

      <Row>
        <Field label={c.titleAr} value={titleAr} onChange={setTitleAr} />
        <Field label={c.titleEn} value={titleEn} onChange={setTitleEn} />
        <Field
          label={c.titleDe}
          value={titleDe}
          onChange={setTitleDe}
          hint={c.localeHint}
        />
      </Row>

      <Row>
        <Field label={c.summaryAr} value={summaryAr} onChange={setSummaryAr} />
        <Field label={c.summaryEn} value={summaryEn} onChange={setSummaryEn} />
        <Field label={c.summaryDe} value={summaryDe} onChange={setSummaryDe} />
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

      <Row>
        <Field
          label={c.startsOn}
          value={startsOn}
          onChange={setStartsOn}
          hint="YYYY-MM-DD"
        />
        <Field label={c.endsOn} value={endsOn} onChange={setEndsOn} hint="YYYY-MM-DD" />
        <Field label={c.seats} value={seats} onChange={setSeats} inputMode="numeric" />
      </Row>

      <Row>
        <Field
          label={c.priceFrom}
          value={priceFrom}
          onChange={setPriceFrom}
          inputMode="decimal"
        />
        <SelectField
          label={c.currency}
          value={currencyCode}
          onChange={setCurrencyCode}
          hint={c.priceHint}
        >
          <option value="">{c.onRequest}</option>
          {currencies.map((one) => (
            <option key={one.code} value={one.code}>
              {one.code}
            </option>
          ))}
        </SelectField>
        {trip ? (
          <SelectField
            label={c.status}
            value={status}
            onChange={setStatus}
            /*
              The requirement is stated where the choice is made, not only when the save fails.

              The «منشورة» option is NOT disabled: the endpoint is the control, and a disabled
              option teaches the rule to whoever can see it while telling somebody who edits the
              DOM nothing. This says what will happen; the API decides whether it does.
            */
            hint={trip?.cover ? c.publishHint : c.coverNeededToPublish}
          >
            {GROUP_TRIP_STATUSES.map((one) => (
              <option key={one} value={one}>
                {label(t.enums.groupTripStatus, one)}
              </option>
            ))}
          </SelectField>
        ) : null}
      </Row>

      {/*
        The photograph.

        Only for a trip that EXISTS: an upload needs a slug to file the object under, and a control
        that looks available before the row is saved is the «built, green, connected to nothing»
        shape — so the placeholder says what to do instead rather than offering a button that
        cannot work.
      */}
      <div className="mt-5 rounded-lg border border-line bg-bg2 p-4">
        <h3 className="text-14 font-bold text-text">{c.cover}</h3>
        <p className="mt-1 text-13 text-muted">{c.coverNote}</p>

        {!trip ? (
          <p className="mt-3 text-13 text-faint">{c.coverSaveFirst}</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-start gap-4">
              {trip.cover && trip.coverUrl ? (
                /*
                  400 and WebP: this is a 160px preview in a form, and asking for the 1600 variant
                  would pull a megabyte into the console to draw a thumbnail. The width comes from
                  `variantWidths`, so it is one that was actually rendered.
                */
                <img
                  src={trip.coverUrl ?? ''}
                  alt=""
                  className="h-24 w-40 rounded-lg border border-line object-cover"
                />
              ) : (
                <p className="text-13 text-faint">{c.coverNone}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3.5 text-13 font-bold text-text transition-colors hover:border-gold/60 lg:min-h-0 lg:py-1.5">
                  {uploading
                    ? c.coverUploading
                    : trip.cover
                      ? c.coverReplace
                      : c.coverUpload}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];

                      if (chosen) void uploadCover(chosen);
                    }}
                  />
                </label>

                {trip.cover ? (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => void removeCover()}
                    className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3.5 text-13 text-bad transition-colors hover:border-bad/60 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
                  >
                    {uploading ? c.coverRemoving : c.coverRemove}
                  </button>
                ) : null}
              </div>
            </div>

            {/*
              Alt text, only once there is a photograph to describe — and saved with «حفظ» like
              every other word on this form, because that is what it is. The CHECK constraint
              refuses alt text with no picture, so offering the fields first would offer a save
              that fails.
            */}
            {trip.cover ? (
              <Row>
                <Field label={c.coverAltAr} value={coverAltAr} onChange={setCoverAltAr} />
                <Field label={c.coverAltEn} value={coverAltEn} onChange={setCoverAltEn} />
                <Field
                  label={c.coverAltDe}
                  value={coverAltDe}
                  onChange={setCoverAltDe}
                  hint={c.coverAltHint}
                />
              </Row>
            ) : null}
          </>
        )}
      </div>

      <Actions
        busy={busy}
        deleting={deleting}
        error={error}
        ready={
          (trip ? true : slug !== '') &&
          titleAr !== '' &&
          summaryAr !== '' &&
          descriptionAr !== '' &&
          startsOn !== '' &&
          endsOn !== ''
        }
        saveLabel={trip ? t.sections.geo.save : t.sections.geo.create}
        busyLabel={trip ? t.sections.geo.saving : t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        {...(trip
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
