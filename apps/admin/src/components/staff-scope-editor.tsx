'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { StaffMemberDetail } from '@/lib/api';
import { apiErrorOf, t } from '@/lib/strings';

/**
 * تحديد النطاق — setting one staff member's cities.
 *
 * ## Why this exists again
 *
 * نطاق العمل on الموظفون was a paged table of everybody's scope AND the editor for it. The table was
 * removed on 2026-08-23 because a scope is a property of a person, not a registry — and the editor
 * went with it, leaving صفحة الموظف stating that scope is enforced server-side above a field nothing
 * could change. `PUT /admin/staff/:userId/scope` survived with no caller at all.
 *
 * ## The whole object, every time
 *
 * The API takes `{ kind, citySlugs, outside }` as one value, so this form always sends all three —
 * including `outside` when it has not been touched. A form that submitted only what it had edited
 * would reset the rest to whatever it defaulted to, which for `outside` means silently granting or
 * removing read access beyond somebody's cities as a side effect of adding a city.
 *
 * ## What is NOT pre-empted
 *
 * `all_cities` with cities selected is a contradiction the API refuses. The form does not hide the
 * checkboxes to prevent it: the refusal is the API's to make and is stated in a language the reader
 * can act on, whereas controls that vanish under you are how people learn a screen is unpredictable.
 * The checkboxes are DISABLED under «كل المدن», which says the same thing without removing anything
 * from the page — and if a disabled box is submitted anyway, the server still refuses.
 */
export function StaffScopeEditor({
  member,
  cities,
}: {
  member: StaffMemberDetail;
  /** From `getGeography()` — the complete set, which is what that screen's exemption is for. */
  cities: readonly { slug: string; nameAr: string }[];
}) {
  const router = useRouter();

  const [kind, setKind] = useState(member.scopeKind);
  const [selected, setSelected] = useState<readonly string[]>(
    member.scopeCities.map((city) => city.slug),
  );
  const [outside, setOutside] = useState(member.outsideScopeAccess);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    if (busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/staff/${member.id}/scope`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          /*
            Sent as chosen, NOT filtered to [] under «كل المدن».

            Clearing them here would turn the contradiction the API refuses into a silent
            correction, and the reader would never learn that the two settings disagree — they
            would simply find, later, that the cities they picked were never saved.
          */
          citySlugs: selected,
          outside,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);

        setError(apiErrorOf(body));
        setBusy(false);
        return;
      }

      setNotice(t.sections.staff.scopeSaved);
      setReason('');
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {notice}
        </p>
      ) : null}

      <fieldset className="grid gap-1.5">
        <legend className="text-[11px] text-faint">
          {t.sections.staff.scopeKindLabel}
        </legend>
        {/*
          Radios rather than a select, because the two choices are the whole decision and a
          collapsed control hides the one that is not chosen.
        */}
        <div className="flex flex-wrap gap-4 text-[12.5px]">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="scopeKind"
              value="all_cities"
              checked={kind === 'all_cities'}
              disabled={busy}
              onChange={() => setKind('all_cities')}
              className="cursor-pointer"
            />
            {t.sections.staff.scopeKindAll}
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="scopeKind"
              value="cities"
              checked={kind === 'cities'}
              disabled={busy}
              onChange={() => setKind('cities')}
              className="cursor-pointer"
            />
            {t.sections.staff.scopeKindCities}
          </label>
        </div>
      </fieldset>

      <fieldset className="grid gap-1.5">
        <legend className="text-[11px] text-faint">
          {t.sections.staff.scopeCitiesLabel}
        </legend>
        {cities.length === 0 ? (
          <p className="text-[12.5px] text-warn">{t.sections.staff.scopeCitiesFailed}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12.5px]">
            {cities.map((city) => (
              <label
                key={city.slug}
                className={`inline-flex items-center gap-2 ${
                  kind === 'all_cities' ? 'text-faint2' : 'cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  value={city.slug}
                  checked={selected.includes(city.slug)}
                  disabled={busy || kind === 'all_cities'}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, city.slug]
                        : current.filter((slug) => slug !== city.slug),
                    )
                  }
                  className="cursor-pointer disabled:cursor-not-allowed"
                />
                {city.nameAr}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-[11px] text-faint">
            {t.sections.staff.scopeOutsideLabel}
          </span>
          <select
            value={outside}
            disabled={busy}
            onChange={(event) =>
              setOutside(event.target.value === 'read_only' ? 'read_only' : 'none')
            }
            className="cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-xs text-text disabled:cursor-not-allowed"
          >
            <option value="none">{t.sections.staff.scopeOutsideNone}</option>
            <option value="read_only">{t.sections.staff.scopeOutsideReadOnly}</option>
          </select>
        </label>

        <label className="grid flex-1 gap-1">
          <span className="text-[11px] text-faint">{t.sections.staff.scopeReason}</span>
          <input
            type="text"
            value={reason}
            maxLength={500}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
            className="min-w-0 rounded-lg border border-line bg-field px-3 py-2 text-xs text-text disabled:cursor-not-allowed"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-2 text-xs text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed lg:min-h-0"
        >
          {busy ? t.sections.staff.scopeSaving : t.sections.staff.scopeSave}
        </button>
      </div>
    </form>
  );
}
