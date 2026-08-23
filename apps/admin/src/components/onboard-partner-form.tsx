'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { LOCALES } from '@safra/contracts';

import type { PartnerType } from '@/lib/api';
import { text } from '@/lib/form';
import { apiError, label, t } from '@/lib/strings';

interface CityOption {
  readonly slug: string;
  readonly nameAr: string;
}

/**
 * تسجيل شريك جديد — the super admin filling in a partner's details with them present
 * (Bashar, 2026-08-23).
 *
 * ## What this form is careful about
 *
 * **There is no password field, and there is no verification field.** Neither is an oversight and
 * both are stated on the screen rather than left as an absence the operator has to notice: the
 * partner sets their own password from a link mailed to them, and approval is a later step behind
 * its own permission. An operator who expects to type a password needs to find out here, while
 * the partner is still sitting there, and not at the end.
 *
 * **The reason note is required.** This path bypasses «طلبات الشراكة», so it also bypasses the
 * paper trail that queue produces — the request, the call log, the decision note. The note is
 * what replaces them, and the field says so.
 *
 * ## Direction
 *
 * No `dir` on any input. The console is RTL and a field a person TYPES INTO follows the page
 * (Bashar, 2026-08-19); the email, the phone and the URL are Latin RUNS, which the bidi algorithm
 * lays out correctly inside an RTL field without being told. `dir="ltr"` would move each field's
 * start edge and put the label on one side of the box and the caret on the other.
 */
export function OnboardPartnerForm({
  partnerTypes,
  cities,
}: {
  partnerTypes: readonly PartnerType[];
  cities: readonly CityOption[];
}) {
  const router = useRouter();
  const formId = useId();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which field the API or the schema objected to, so the message lands under it. */
  const [field, setField] = useState<string | null>(null);

  async function submit(form: FormData): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setField(null);

    /*
      Every field through `text()`, never `String(form.get(...))`.

      `FormData.get` returns `string | File | null`, so `String()` yields `'[object File]'` for a
      file input and `'null'` for a missing one — either of which would be POSTED as if somebody
      had typed it. `text()` narrows first, so an unexpected shape becomes an empty string and
      fails validation visibly. The linter enforces it.
    */
    const website = text(form, 'website').trim();

    const body = {
      contactName: text(form, 'contactName').trim(),
      email: text(form, 'email').trim(),
      phone: text(form, 'phone').trim(),
      legalName: text(form, 'legalName').trim(),
      displayName: text(form, 'displayName').trim(),
      partnerTypeCode: text(form, 'partnerTypeCode'),
      citySlug: text(form, 'citySlug'),
      address: text(form, 'address').trim(),
      /*
        Omitted rather than sent empty. The schema types it as an optional URL, so `''` is a
        malformed URL and not "no website" — the difference between a form that saves and one
        that refuses for a field the operator deliberately left blank.
      */
      ...(website ? { website } : {}),
      notes: text(form, 'notes').trim(),
      /* `||`, not `??`: `text()` answers with an empty string, which the schema would refuse. */
      preferredLocale: text(form, 'preferredLocale') || 'ar',
    };

    try {
      const response = await fetch('/api/partner-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        /*
          `apiError` never returns empty — it falls back to the generic Arabic sentence — so there
          is no `||` here. A coded refusal reads as itself; anything else reads as "something went
          wrong", which is the honest answer when the API did not name a reason.
        */
        setError(apiError(messageOf(payload)));
        setField(fieldOf(payload));
        setBusy(false);

        return;
      }

      const reference = referenceOf(payload);

      if (!reference) {
        setError(t.sections.partnerOnboarding.failed);
        setBusy(false);

        return;
      }

      /*
        Straight on to the remaining steps, carrying `created` so the next screen can say the
        record exists and where the invitation went. `replace`, not `push`: coming BACK to a
        blank creation form after a partner has been created invites a second one.
      */
      const created = new URLSearchParams({
        created: '1',
        ...(accountExistedOf(payload) ? { adopted: '1' } : {}),
      });

      router.replace(
        `/partners/${encodeURIComponent(reference)}/onboarding?${created.toString()}`,
      );
    } catch {
      setError(t.sections.partnerOnboarding.unreachable);
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(new FormData(event.currentTarget));
      }}
    >
      <p className="rounded-lg border border-gold/30 bg-gold/5 px-4 py-3 text-[12.5px] leading-relaxed text-gold">
        {t.sections.partnerOnboarding.passwordNote}
      </p>

      {error ? (
        <p role="alert" className="text-[12.5px] text-bad">
          {error}
        </p>
      ) : null}

      <Fieldset legend={t.sections.partnerOnboarding.contactSection}>
        <Field
          id={`${formId}-contactName`}
          name="contactName"
          label={t.sections.partnerOnboarding.contactName}
          hint={t.sections.partnerOnboarding.contactNameHint}
          invalid={field === 'contactName'}
          required
          maxLength={120}
        />
        <Field
          id={`${formId}-email`}
          name="email"
          type="email"
          label={t.sections.partnerOnboarding.email}
          hint={t.sections.partnerOnboarding.emailHint}
          invalid={field === 'email'}
          required
          maxLength={320}
        />
        <Field
          id={`${formId}-phone`}
          name="phone"
          type="tel"
          label={t.sections.partnerOnboarding.phone}
          invalid={field === 'phone'}
          required
          maxLength={32}
        />
      </Fieldset>

      <Fieldset legend={t.sections.partnerOnboarding.businessSection}>
        <Field
          id={`${formId}-legalName`}
          name="legalName"
          label={t.sections.partnerOnboarding.legalName}
          hint={t.sections.partnerOnboarding.legalNameHint}
          invalid={field === 'legalName'}
          required
          maxLength={200}
        />
        <Field
          id={`${formId}-displayName`}
          name="displayName"
          label={t.sections.partnerOnboarding.displayName}
          hint={t.sections.partnerOnboarding.displayNameHint}
          invalid={field === 'displayName'}
          required
          maxLength={120}
        />

        <div className="grid gap-1.5">
          <label
            htmlFor={`${formId}-partnerTypeCode`}
            className="text-[11.5px] font-semibold text-muted"
          >
            {t.sections.partnerOnboarding.partnerType}
          </label>
          <select
            id={`${formId}-partnerTypeCode`}
            name="partnerTypeCode"
            required
            defaultValue={partnerTypes[0]?.code ?? ''}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13px] font-normal text-text"
          >
            {partnerTypes.map((type) => (
              <option key={type.code} value={type.code}>
                {type.nameAr}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label
            htmlFor={`${formId}-citySlug`}
            className="text-[11.5px] font-semibold text-muted"
          >
            {t.sections.partnerOnboarding.city}
          </label>
          <select
            id={`${formId}-citySlug`}
            name="citySlug"
            required
            defaultValue={cities[0]?.slug ?? ''}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13px] font-normal text-text"
          >
            {cities.map((city) => (
              <option key={city.slug} value={city.slug}>
                {city.nameAr}
              </option>
            ))}
          </select>
        </div>

        <Field
          id={`${formId}-address`}
          name="address"
          label={t.sections.partnerOnboarding.address}
          invalid={field === 'address'}
          required
          maxLength={300}
        />
        <Field
          id={`${formId}-website`}
          name="website"
          type="url"
          label={t.sections.partnerOnboarding.website}
          invalid={field === 'website'}
          maxLength={300}
        />

        <div className="grid gap-1.5">
          <label
            htmlFor={`${formId}-preferredLocale`}
            className="text-[11.5px] font-semibold text-muted"
          >
            {t.sections.partnerOnboarding.locale}
          </label>
          <select
            id={`${formId}-preferredLocale`}
            name="preferredLocale"
            defaultValue="ar"
            aria-describedby={`${formId}-preferredLocale-hint`}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13px] font-normal text-text"
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {label(t.enums.locales, locale)}
              </option>
            ))}
          </select>
          <span
            id={`${formId}-preferredLocale-hint`}
            className="text-[10.5px] font-normal text-faint"
          >
            {t.sections.partnerOnboarding.localeHint}
          </span>
        </div>
      </Fieldset>

      <div className="grid gap-1.5">
        <label
          htmlFor={`${formId}-notes`}
          className="text-[11.5px] font-semibold text-muted"
        >
          {t.sections.partnerOnboarding.notes}
        </label>
        <textarea
          id={`${formId}-notes`}
          name="notes"
          rows={3}
          required
          maxLength={2000}
          aria-invalid={field === 'notes' ? true : undefined}
          aria-describedby={`${formId}-notes-hint`}
          className={`rounded-[9px] border bg-field px-3 py-2.5 text-[13px] font-normal text-text ${
            field === 'notes' ? 'border-bad' : 'border-line'
          }`}
        />
        <span
          id={`${formId}-notes-hint`}
          className="text-[10.5px] font-normal text-faint"
        >
          {t.sections.partnerOnboarding.notesHint}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-ok px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
        >
          {busy
            ? t.sections.partnerOnboarding.submitting
            : t.sections.partnerOnboarding.submit}
        </button>
      </div>
    </form>
  );
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-line bg-card p-4 sm:grid-cols-2">
      <legend className="px-1 text-[12px] font-semibold text-text">{legend}</legend>
      {children}
    </fieldset>
  );
}

/**
 * One labelled text input.
 *
 * `id` is passed rather than generated inside, so the label's `htmlFor` and the input's `id` are
 * written in one place — two that are written separately drift, and the failure is silent: the
 * label stops being clickable and stops being announced.
 *
 * ## The hint is OUTSIDE the `<label>`, referenced by `aria-describedby`
 *
 * It was inside it, and that made the hint part of the field's accessible NAME: «الاسم القانوني»
 * announced as «الاسم القانوني كما هو في السجل التجاري.». Two costs, and the first is the real one
 * — a name is what a screen-reader user hears when they land on the field and what they hear again
 * in a list of form controls, so folding a sentence of guidance into it makes every field a
 * paragraph. A DESCRIPTION is announced after the name and can be skipped, which is what a hint is.
 *
 * The second cost is how it was found: `getByLabel('الاسم القانوني')` matched two fields, because
 * «الاسم المعروض»'s hint also contains those words. `e2e/staff.ts` documents the same trap on the
 * sign-in form. A locator collision is a symptom here, not the reason for the fix.
 */
function Field({
  id,
  name,
  label: text,
  hint,
  type = 'text',
  required = false,
  invalid = false,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string | undefined;
  type?: string | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  maxLength?: number | undefined;
}) {
  const hintId = `${id}-hint`;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[11.5px] font-semibold text-muted">
        {text}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={hint ? hintId : undefined}
        className={`min-h-10 rounded-[9px] border bg-field px-3 py-2.5 text-[13px] font-normal text-text lg:min-h-0 ${
          invalid ? 'border-bad' : 'border-line'
        }`}
      />
      {hint ? (
        <span id={hintId} className="text-[10.5px] font-normal text-faint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;

  return typeof message === 'string' ? message : null;
}

function fieldOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('field' in body)) return null;

  const { field } = body;

  return typeof field === 'string' ? field : null;
}

function referenceOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('reference' in body)) return null;

  const { reference } = body;

  return typeof reference === 'string' ? reference : null;
}

function accountExistedOf(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('accountExisted' in body)) {
    return false;
  }

  return body.accountExisted === true;
}
