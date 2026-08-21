'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fill, t } from '@/lib/strings';

interface Candidate {
  name: string;
  designationId: string;
  subjectType: string;
  programme: string | null;
  details: string | null;
  similarity: number;
  tokenOverlap: number;
  confidence: 'strong' | 'possible' | 'weak';
}

/**
 * Running a sanctions screening (ADR 0002, §8.1).
 *
 * The platform performs the search itself against the imported EU consolidated list.
 * Until item 120 landed this panel only RECORDED what a staff member said they had
 * found, which meant a legal obligation could be satisfied by an assertion; now the
 * button runs the check and the reviewer judges what it returns.
 *
 * The judgement stays human on purpose. The matcher deliberately over-flags — a
 * false positive costs half a minute, a missed designation is a legal exposure for
 * the German entity — so it produces candidates with a confidence and a reason, and
 * a person decides whether the hit is the same party.
 */
export function ScreeningPanel({
  reference,
  screenedAt,
  result,
  listStatus,
}: {
  reference: string;
  screenedAt: string | null;
  result: unknown;
  listStatus: {
    imported: boolean;
    stale: boolean;
    ageDays: number | null;
    fixtureLoaded: boolean;
  } | null;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<boolean | null>(null);

  async function run(matched?: boolean) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/partners/${reference}/screening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(matched === undefined ? {} : { matched }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(messageOf(body) ?? t.sections.panels.screeningFailed);
        setBusy(false);
        return;
      }

      setOverride(null);
      router.refresh();
      setBusy(false);
    } catch {
      setError(t.sections.panels.unreachable);
      setBusy(false);
    }
  }

  const previous = readResult(result);

  /**
   * The list's own state comes first. A reviewer who clicks and gets an unexplained
   * refusal will assume the feature is broken; telling them the list is nine days
   * old points at the actual problem, which somebody can fix.
   *
   * A loaded development fixture gets its own sentence for the same reason. It is not
   * a sanctions list and screening never looks at it, so «no list imported» is true —
   * and reads as a bug to whoever just watched their own import succeed.
   */
  if (listStatus && (!listStatus.imported || listStatus.stale)) {
    return (
      <div className="rounded-lg border border-bad/40 bg-bad/10 p-4">
        <p className="text-sm text-bad">
          {listStatus.imported
            ? fill(t.sections.screening.listStale, { days: listStatus.ageDays ?? 0 })
            : listStatus.fixtureLoaded
              ? t.sections.screening.listFixture
              : t.sections.screening.listMissing}
        </p>
        <p className="mt-2 text-xs text-muted">{t.sections.screening.blockedNote}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      {screenedAt ? (
        <div>
          <p className={`text-sm ${previous.matched ? 'text-bad' : 'text-ok'}`}>
            {previous.matched
              ? t.sections.screening.possibleMatch
              : t.sections.screening.noMatch}
          </p>
          <p className="mt-1 text-xs text-faint">
            {previous.searched.length > 0
              ? fill(t.sections.screening.recordedOnSearched, {
                  date: screenedAt.slice(0, 10),
                  terms: previous.searched.join(', '),
                })
              : fill(t.sections.screening.recordedOn, { date: screenedAt.slice(0, 10) })}
          </p>

          {previous.candidates.length > 0 ? (
            <ul className="mt-3 grid gap-2">
              {previous.candidates.map((candidate) => (
                <li
                  key={`${candidate.designationId}-${candidate.name}`}
                  className="rounded border border-line bg-field px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-text">{candidate.name}</span>
                    <ConfidencePill confidence={candidate.confidence} />
                  </div>
                  {/*
                    The numbers are shown, not hidden behind the label. A reviewer
                    dismissing a hit needs to see it scored 0.4 on letters and shares
                    no name part — otherwise the only options are blind trust or
                    blanket dismissal.
                  */}
                  <p className="mt-1 text-xs text-faint">
                    {candidate.programme
                      ? fill(t.sections.screening.matchLineProgramme, {
                          subject: candidate.subjectType,
                          similarity: candidate.similarity,
                          parts: candidate.tokenOverlap,
                          programme: candidate.programme,
                        })
                      : fill(t.sections.screening.matchLine, {
                          subject: candidate.subjectType,
                          similarity: candidate.similarity,
                          parts: candidate.tokenOverlap,
                        })}
                  </p>
                  {candidate.details ? (
                    <p className="mt-1 text-xs text-muted">{candidate.details}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-gold">{t.sections.screening.notScreened}</p>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-bad">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="cursor-pointer rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy
            ? t.sections.panels.screeningSearching
            : screenedAt
              ? t.sections.panels.screeningAgain
              : t.sections.panels.screeningRun}
        </button>

        {/*
          The override, available only after a check has run. Overriding a result
          that does not exist would be the assertion-based screening this replaced.
        */}
        {screenedAt ? (
          <>
            <button
              type="button"
              onClick={() => setOverride(previous.matched ? false : true)}
              disabled={busy}
              className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {previous.matched
                ? t.sections.panels.screeningMarkNoMatch
                : t.sections.panels.screeningMarkMatch}
            </button>
          </>
        ) : null}
      </div>

      {override !== null ? (
        <div className="mt-3 rounded border border-gold/30 bg-gold/5 p-3">
          <p className="text-xs text-gold">
            {override
              ? t.sections.panels.screeningMatchWarning
              : t.sections.panels.screeningClearWarning}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void run(override)}
              disabled={busy}
              className="cursor-pointer rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {t.sections.screening.confirmOverride}
            </button>
            <button
              type="button"
              onClick={() => setOverride(null)}
              className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
            >
              {t.sections.settings.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: Candidate['confidence'] }) {
  const tone =
    confidence === 'strong'
      ? 'border-bad/40 bg-bad/10 text-bad'
      : confidence === 'possible'
        ? 'border-gold/40 bg-gold/10 text-gold'
        : 'border-line bg-field text-faint';

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>
      {confidence}
    </span>
  );
}

/** Reads the stored payload defensively — its shape has changed once already. */
function readResult(result: unknown): {
  matched: boolean;
  searched: string[];
  candidates: Candidate[];
} {
  if (typeof result !== 'object' || result === null) {
    return { matched: false, searched: [], candidates: [] };
  }

  const record = result as Record<string, unknown>;

  return {
    matched: record['matched'] === true,
    searched: Array.isArray(record['searched'])
      ? record['searched'].filter((s): s is string => typeof s === 'string')
      : [],
    candidates: Array.isArray(record['candidates'])
      ? (record['candidates'] as Candidate[])
      : [],
  };
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
