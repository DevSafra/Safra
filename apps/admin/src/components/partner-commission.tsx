'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Actions, Field, Row } from '@/components/geo-form';
import { t, apiErrorOf } from '@/lib/strings';

/**
 * A partner's negotiated commission — the rate, the ceiling, or neither.
 *
 * Bashar (2026-08-31): «add a نسبة العمولة in % and the max range in $ inputs on the partner
 * details page … The super admin will define the values for each partner manually.»
 *
 * ## Empty is a value, not a missing one
 *
 * Blank rate means «use the platform rate», blank cap means «no ceiling», and both are sent as
 * `null` rather than omitted. That distinction is the whole design: a partner who negotiated 0%
 * and a partner nobody has negotiated with are different arrangements, and a form that could not
 * express the difference would bill one of them wrongly. The placeholder says which is which, so
 * an empty box reads as a decision rather than as something unfinished.
 *
 * ## Percent here, fraction in the database
 *
 * A person says «7.25%» and `commission.partner_rate` stores `0.0725`. The conversion happens on
 * the way in and out of this form so the stored value keeps the same shape as the platform
 * setting it overrides — two representations of one number in one system is how they drift.
 */
export function PartnerCommission({
  reference,
  rate,
  capUsd,
}: {
  readonly reference: string;
  /** The stored FRACTION, or null for «use the platform rate». */
  readonly rate: string | null;
  /** The stored ceiling in USD, or null for «no ceiling». */
  readonly capUsd: string | null;
}) {
  const router = useRouter();
  const c = t.sections.partnerDetail;

  /**
   * The stored fraction as a percentage — «0.0725» to «7.25».
   *
   * NOT `Number(value) * 100`, which is what this was: 0.0725 × 100 is 7.249999999999999 in
   * binary floating point, and the browser suite caught it sitting in the input box. The column is
   * `numeric(5,4)`, so multiplying by 10,000 lands on an exact integer no matter what the value
   * is; dividing that by 100 then prints the shortest correct decimal. Trailing zeros go with it,
   * so 0.0700 reads as «7» rather than «7.00».
   */
  const asPercent = (value: string | null): string =>
    value === null ? '' : String(Math.round(Number(value) * 10_000) / 100);

  const [percent, setPercent] = useState(asPercent(rate));
  const [cap, setCap] = useState(capUsd === null ? '' : String(Number(capUsd)));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Blank is `null` — a deliberate «no term», not a zero. */
  const numberOrNull = (value: string): number | null =>
    value.trim() === '' ? null : Number(value);

  const ready =
    (percent.trim() === '' || Number.isFinite(Number(percent))) &&
    (cap.trim() === '' || Number.isFinite(Number(cap)));

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      /*
        Rounded to the column's own scale on the way in, for the same reason: 7.25 / 100 is not
        exactly representable, and a value that arrives with a float tail would be silently
        rounded by Postgres rather than by anything a reader could see.
      */
      const typed = numberOrNull(percent);
      const asFraction = typed === null ? null : Math.round(typed * 100) / 10_000;

      const response = await fetch(
        `/api/partners/${encodeURIComponent(reference)}/commission`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commissionRate: asFraction,
            commissionCapUsd: numberOrNull(cap),
          }),
        },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-partner-commission={reference} className="grid gap-3">
      <p className="text-[12px] leading-relaxed text-faint2">{c.commissionNote}</p>

      <Row>
        {/*
          No `dir` on either field — the page's own direction. A number is a left-to-right RUN and
          the bidi algorithm lays it out correctly inside an RTL field without being told.
        */}
        <Field
          label={c.commissionRate}
          name="commissionRate"
          value={percent}
          onChange={setPercent}
          hint={c.commissionRateHint}
        />
        <Field
          label={c.commissionCap}
          name="commissionCapUsd"
          value={cap}
          onChange={setCap}
          hint={c.commissionCapHint}
        />
      </Row>

      {/* What an empty box currently MEANS, said rather than left to be inferred. */}
      <p className="text-[11.5px] text-muted">
        {percent.trim() === '' ? c.commissionPlatform : `${percent}%`}
        {' · '}
        {cap.trim() === '' ? c.commissionNoCap : `$${cap}`}
      </p>

      <Actions
        busy={busy}
        ready={ready}
        error={error}
        saveLabel={t.sections.geo.save}
        busyLabel={t.sections.geo.saving}
        cancelLabel={t.sections.geo.cancel}
        onSave={() => void save()}
        onClose={() => {
          setPercent(asPercent(rate));
          setCap(capUsd === null ? '' : String(Number(capUsd)));
          setError(null);
          setSaved(false);
        }}
      />

      {saved ? (
        <p className="text-[11.5px] font-semibold text-ok">{c.commissionSaved}</p>
      ) : null}
    </div>
  );
}
