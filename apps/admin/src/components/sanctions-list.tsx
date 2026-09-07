'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { z } from 'zod';

import type { SanctionsStatus } from '@/lib/api';
import { ConsolePanel } from '@/components/console-shell';
import { count, shortDateTime } from '@/lib/format';
import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * The sanctions list: what is on record, and the way to replace it.
 *
 * ## Why it is here (Bashar, 2026-09-07)
 *
 * «Please add the missing administrative surface for manual refresh/import so the platform is not
 * blocked solely by configuration.»
 *
 * `POST /admin/sanctions/import` was written as the documented fallback for a missing feed URL or a
 * lapsed publisher token — and nothing in any of the three applications called it. Measured the
 * same day: the only snapshot on the platform was 17 days old against a 7-day limit, so screening
 * refused and every partner verification was blocked. The daily refresh had never run because
 * `SANCTIONS_FEED_URL` was unset. So the automatic route was unconfigured, the manual route was
 * unbuilt, and the third option was to page an engineer.
 *
 * ## In settings, not on the partner screen
 *
 * The partner detail page already SHOWS this status, at the moment a reviewer needs it. It is not
 * where the list is replaced: importing takes `SETTINGS_UPDATE`, which only a super admin holds,
 * and offering the control to every reviewer who can read the status would be offering a button
 * most of them cannot press.
 *
 * ## The state comes first, the action second
 *
 * Somebody opening this panel is usually here because a verification refused. The age and the
 * consequence are the first thing on the screen; the file input is below them.
 */
/** What the import answers with. Only the figure the operator is shown. */
const importedSchema = z.object({ entryCount: z.number() });

export function SanctionsList({ status }: { readonly status: SanctionsStatus }) {
  const c = t.sections.settings;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<'eu_consolidated'>('eu_consolidated');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function importList(): Promise<void> {
    const file = input.current?.files?.[0];

    if (!file) {
      setError(c.sanctionsPickFile);

      return;
    }

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      /*
        Read in the BROWSER and posted as a string, because that is what the endpoint takes. A
        multipart upload would need a second shape on the API for no gain — the list is text, and
        the size floor in the contract is what catches a truncated download.
      */
      const xml = await file.text();
      const response = await fetch('/api/sanctions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml, source }),
      });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      /*
        Parsed, not trusted — the same rule every other response in this console follows. The count
        is what the operator is told, so a payload that does not carry one must report zero rather
        than «NaN مُدرَجاً».
      */
      const parsed = importedSchema.safeParse(await response.json().catch(() => null));

      setDone(parsed.success ? parsed.data.entryCount : 0);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  const policyLine =
    status.policy === 'required'
      ? c.sanctionsPolicyRequired
      : status.policy === 'advisory'
        ? c.sanctionsPolicyAdvisory
        : c.sanctionsPolicyOff;

  return (
    <ConsolePanel>
      <section data-sanctions className="grid gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[14px] font-extrabold text-gold">{c.sanctionsTitle}</h2>

          {/*
            The consequence, in the reader's face rather than derived from a date.

            `stale` and `imported` come from the API together with the POLICY, because «القائمة
            قديمة» means «verification is blocked» under `required` and «the screening you were
            about to skip would have been unreliable anyway» under `advisory`. Two different things
            to do about one fact.
          */}
          <span
            className={`ms-auto text-[12px] font-bold ${
              status.imported && !status.stale ? 'text-ok' : 'text-bad'
            }`}
          >
            {!status.imported
              ? c.sanctionsNever
              : status.stale
                ? c.sanctionsStale
                : c.sanctionsFresh}
          </span>
        </div>

        <p className="text-[11.5px] leading-relaxed text-text2">{c.sanctionsNote}</p>
        <p className="text-[11.5px] text-faint">{policyLine}</p>

        {status.imported ? (
          <dl className="grid gap-2 text-[12.5px] sm:grid-cols-3">
            <Fact label={c.sanctionsEntries} value={count(status.entryCount)} />
            <Fact
              label={c.sanctionsFetched}
              value={status.fetchedAt ? shortDateTime(status.fetchedAt) : '—'}
            />
            <Fact
              label={c.sanctionsAge}
              value={
                status.ageDays === null
                  ? '—'
                  : fill(c.sanctionsAgeDays, { n: count(status.ageDays) })
              }
            />
          </dl>
        ) : null}

        <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
            {c.sanctionsUpload}
            <input
              ref={input}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="min-h-10 cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-[12px] text-text file:me-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[rgba(var(--goldA),0.14)] file:px-3 file:py-1.5 file:text-[11.5px] file:font-bold file:text-gold lg:min-h-0"
            />
            <span className="text-[10.5px] font-normal text-faint2">
              {c.sanctionsUploadHint}
            </span>
          </label>

          <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
            {c.sanctionsSource}
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as 'eu_consolidated')}
              className="min-h-10 cursor-pointer rounded-lg border border-line bg-field px-3 text-[12.5px] text-text lg:min-h-0"
            >
              {/*
                One option, deliberately. `SANCTIONS_SOURCES` also has `local_fixture`, which the
                API refuses outside development — offering it here would be offering a choice that
                answers with a refusal in the only environment that matters.
              */}
              <option value="eu_consolidated">{c.sanctionsSourceEu}</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => void importList()}
            disabled={busy}
            className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] bg-[rgba(var(--goldA),0.06)] px-3 text-[12.5px] font-bold text-gold transition-transform duration-150 ease-out active:scale-[0.98] disabled:cursor-default disabled:opacity-60 lg:min-h-0 lg:py-1.5"
          >
            {busy ? c.sanctionsImporting : c.sanctionsImport}
          </button>
        </div>

        {error === null ? null : <p className="text-[11.5px] text-bad">{error}</p>}
        {done === null ? null : (
          <p className="text-[11.5px] text-ok">
            {fill(c.sanctionsImported, { n: count(done) })}
          </p>
        )}
      </section>
    </ConsolePanel>
  );
}

/** One fact about the list. A bordered pair, matching the payout summary's arrangement. */
function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border border-line2 px-3 py-2">
      <dt className="text-[10.5px] text-faint">{label}</dt>
      <dd className="font-bold tabular-nums text-text">{value}</dd>
    </div>
  );
}
