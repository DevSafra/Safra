'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiErrorOf, fill, t } from '@/lib/strings';
import type { PropertyType } from '@/lib/api';
import { Ltr } from '@/components/admin-table';

/**
 * §8.2 — «أنواع أخرى قابلة للإضافة من الإدارة».
 *
 * The seven types the SRS lists were rows nothing could write, so adding an eighth meant a
 * migration and a deploy. This is the smallest thing that satisfies the sentence: the list, an add
 * form, and a way to retire one.
 *
 * Retiring rather than deleting is not squeamishness — `properties.property_type_id` is a foreign
 * key, so a type in use cannot be removed, and removing an unused one would erase the record of
 * what the platform once offered. `inUse` is shown beside each row so a reader knows what they are
 * taking away before they take it.
 */
export function PropertyTypes({ types }: { types: readonly PropertyType[] }) {
  const copy = t.sections.propertyTypes;
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function call(path: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, init);

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        /* The CODE resolved into Arabic — never the API's English `message`. */
        setError(apiErrorOf(payload));

        return false;
      }

      router.refresh();

      return true;
    } catch {
      setError(t.sections.panels.failed);

      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <ul className="grid gap-1.5">
        {types.map((type) => (
          <li
            key={type.code}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2"
          >
            <span className="min-w-0 text-[13px] text-text">
              {type.nameAr} <Ltr className="text-[11px] text-faint">{type.code}</Ltr>
              {type.isActive ? null : (
                <span className="ms-2 text-[11px] text-faint">{copy.retired}</span>
              )}
            </span>

            <span className="flex items-center gap-3 text-[11px] text-muted">
              {fill(copy.inUse, { n: String(type.inUse) })}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void call(`/api/property-types/${encodeURIComponent(type.code)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isActive: !type.isActive }),
                  })
                }
                className="cursor-pointer text-sky hover:underline disabled:cursor-not-allowed"
              >
                {type.isActive ? copy.retire : copy.restore}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {open ? (
        <form
          className="grid gap-2 rounded-lg border border-line bg-card p-3"
          onSubmit={(event) => {
            event.preventDefault();

            const form = new FormData(event.currentTarget);

            void call('/api/property-types', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: form.get('code'),
                nameAr: form.get('nameAr'),
                nameEn: form.get('nameEn'),
                nameDe: form.get('nameDe'),
                hasMultipleUnits: form.get('hasMultipleUnits') === 'on',
              }),
            }).then((ok) => {
              if (ok) setOpen(false);
            });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {/*
              All three languages are required, because §8.2's list is customer-facing and the
              catalogue rule is total — a type with no German name is a German customer reading
              Arabic in a filter.

              No `dir` on any of these: the page is RTL and the Latin runs inside `code` and the
              English name lay out correctly on their own.
            */}
            <Field
              name="code"
              label={copy.code}
              placeholder="guest_house"
              disabled={busy}
            />
            <Field name="nameAr" label={copy.nameAr} disabled={busy} />
            <Field name="nameEn" label={copy.nameEn} disabled={busy} />
            <Field name="nameDe" label={copy.nameDe} disabled={busy} />
          </div>

          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              name="hasMultipleUnits"
              disabled={busy}
              className="cursor-pointer"
            />
            {copy.hasMultipleUnits}
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-10 cursor-pointer rounded-lg border border-line px-4 text-[12.5px] text-text disabled:cursor-not-allowed lg:min-h-0"
            >
              {busy ? copy.saving : copy.save}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="min-h-10 cursor-pointer px-3 text-[12.5px] text-muted lg:min-h-0"
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-10 w-fit cursor-pointer rounded-lg border border-line px-4 text-[12.5px] text-text lg:min-h-0"
        >
          {copy.add}
        </button>
      )}

      {error ? (
        <p role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  disabled,
}: {
  name: string;
  label: string;
  placeholder?: string;
  disabled: boolean;
}) {
  return (
    <label className="grid gap-1 text-[11px] text-faint">
      {label}
      <input
        name={name}
        required
        maxLength={80}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-10 rounded-[9px] border border-line bg-field px-3 py-2 text-[13px] text-text disabled:cursor-not-allowed lg:min-h-0"
      />
    </label>
  );
}
