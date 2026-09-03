'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { errorMessage, errorParams } from '@safra/i18n';
import { isErrorCode, partnerApplicationSchema } from '@safra/contracts';

import type { Locale } from '@/i18n/routing';
import { PhoneField } from '@/components/phone-field';

/** What the page hands down: real rows, so the form cannot offer a city that does not exist. */
export interface JoinOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The «انضم كشريك» form (Bashar, 2026-08-19).
 *
 * ## It creates a REQUEST, not an account
 *
 * There is no password field and no email field, and both absences are the feature. The old
 * `POST /partner/register` took a password and created a partner account outright; the flow Bashar
 * specified puts a phone call and a super admin's acceptance in between, so nothing typed here can
 * grant anybody anything. And since applying requires a session (Bashar, 2026-08-19) the address
 * is the ACCOUNT's — shown, not asked for — so a request cannot be filed against somebody else's
 * mailbox. Told to the applicant in the steps above the form, because a form that asks for a
 * business's legal name and gives no password box needs to say why.
 *
 * ## Validated here AND at the API, and the two share one schema
 *
 * `partnerApplicationSchema` from `@safra/contracts` is the same object the API validates with, so
 * the inline errors under the fields cannot disagree with the refusal that comes back. Client-side
 * validation is a courtesy — an incomplete phone number caught before a round trip — and never a
 * control: everything is re-checked server-side.
 *
 * ## No `dir` on any input
 *
 * A field a person types into follows the page (docs/i18n.md §9). On the Arabic site that means
 * RTL, and the Latin runs inside — an email, a URL, a phone number — lay out correctly on their
 * own because the bidi algorithm handles a run inside an RTL field.
 */
export function PartnerApplicationForm({
  locale,
  email,
  cities,
  partnerTypes,
}: {
  readonly locale: Locale;
  /**
   * The signed-in account's address, shown so the applicant knows where we will write.
   *
   * DISPLAY ONLY, and it has to be — the session's `user` blob is not signed (see
   * `packages/session`). The API reads the address from the token instead, so this cannot be
   * anything but a label: editing the cookie changes what this line says and nothing else.
   */
  readonly email: string;
  readonly cities: readonly JoinOption[];
  readonly partnerTypes: readonly JoinOption[];
}) {
  const t = useTranslations('partner');

  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setBusy(true);
    setErrors({});
    setFailure(null);

    const data = new FormData(event.currentTarget);
    /*
      `FormData.get` returns `string | File | null`, and every field on this form is a text input —
      but a `File` reaching `String()` renders as `[object Object]`, which would travel to the API
      as somebody's business name. Narrowed rather than coerced.
    */
    const value = (name: string): string => {
      const raw = data.get(name);

      return typeof raw === 'string' ? raw.trim() : '';
    };

    const candidate = {
      contactName: value('contactName'),
      phone,
      legalName: value('legalName'),
      displayName: value('displayName'),
      partnerTypeCode: value('partnerTypeCode'),
      citySlug: value('citySlug'),
      address: value('address'),
      preferredLocale: value('preferredLocale') || locale,
      /* Omitted rather than sent empty: the schema treats absent and blank differently. */
      ...(value('propertyCount')
        ? { propertyCount: Number(value('propertyCount')) }
        : {}),
      ...(value('website') ? { website: value('website') } : {}),
      ...(value('message') ? { message: value('message') } : {}),
    };

    const parsed = partnerApplicationSchema.safeParse(candidate);

    if (!parsed.success) {
      /*
        Keyed by the schema's own field paths, so a message lands under the input it is about.
        The Zod messages ARE error codes (see `docs/i18n.md`), resolved in the reader's language.
      */
      const found: Record<string, string> = {};

      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');

        if (field && !found[field]) {
          found[field] = isErrorCode(issue.message)
            ? errorMessage(issue.message, locale)
            : issue.message;
        }
      }

      setErrors(found);
      setBusy(false);

      return;
    }

    try {
      const response = await fetch(`/${locale}/api/partner-applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const code =
          typeof payload === 'object' && payload !== null && 'code' in payload
            ? String(payload.code)
            : '';

        setFailure(
          isErrorCode(code)
            ? errorMessage(code, locale, errorParams(payload))
            : t('failed'),
        );

        return;
      }

      const got =
        typeof payload === 'object' && payload !== null && 'reference' in payload
          ? String(payload.reference)
          : '';

      setReference(got);
    } catch {
      setFailure(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <section
        data-application-sent
        className="rounded-2xl border border-[rgba(var(--goldA),0.25)] bg-card p-6"
      >
        <h2 className="text-xl font-bold text-gold">{t('successTitle')}</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-text">
          {t('successBody', { reference })}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('successKeep')}</p>
        <Link
          href={`/${locale}`}
          className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-[13px] text-muted lg:min-h-0 lg:py-2"
        >
          {t('backHome')}
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
      <fieldset className="grid gap-4">
        <legend className="mb-2 text-[15px] font-bold text-gold-ink">
          {t('sectionContact')}
        </legend>

        <Field
          name="contactName"
          label={t('contactName')}
          error={errors['contactName']}
        />
        {/*
          The address, stated rather than asked for.

          A field here would let somebody signed in as themselves file a request against another
          person's mailbox, which is the whole class of problem requiring a session removed.
        */}
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold text-text">{t('email')}</span>
          <p className="min-h-11 rounded-xl border border-line bg-card px-3.5 py-3 text-[14px] text-muted">
            {email}
          </p>
          <span className="text-[12px] text-faint">{t('emailHint')}</span>
        </div>

        <PhoneField
          locale={locale}
          label={t('phone')}
          hint={t('phoneHint')}
          onChange={setPhone}
          {...(errors['phone'] ? { error: errors['phone'] } : {})}
        />

        <Select
          name="preferredLocale"
          label={t('locale')}
          defaultValue={locale}
          options={[
            /*
              ENDONYMS, unlike the console's Arabic names for the same three.

              The applicant is choosing the language THEY will be written to in, so each has to be
              recognisable to somebody who does not read the others. A documented i18n exception.
            */
            { value: 'ar', label: 'العربية' },
            { value: 'en', label: 'English' },
            { value: 'de', label: 'Deutsch' },
          ]}
        />
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-[15px] font-bold text-gold-ink">
          {t('sectionBusiness')}
        </legend>

        <Field
          name="legalName"
          label={t('legalName')}
          hint={t('legalNameHint')}
          error={errors['legalName']}
        />
        <Field
          name="displayName"
          label={t('displayName')}
          hint={t('displayNameHint')}
          error={errors['displayName']}
        />

        <Select
          name="partnerTypeCode"
          label={t('partnerType')}
          placeholder={t('choose')}
          options={partnerTypes.map((row) => ({ value: row.value, label: row.label }))}
          {...(errors['partnerTypeCode'] ? { error: errors['partnerTypeCode'] } : {})}
        />

        <Select
          name="citySlug"
          label={t('city')}
          placeholder={t('choose')}
          options={cities.map((row) => ({ value: row.value, label: row.label }))}
          {...(errors['citySlug'] ? { error: errors['citySlug'] } : {})}
        />

        <Field name="address" label={t('address')} error={errors['address']} />
        <Field
          name="propertyCount"
          type="number"
          label={t('propertyCount')}
          error={errors['propertyCount']}
        />
        <Field name="website" label={t('website')} error={errors['website']} />

        <label className="grid gap-1.5">
          <span className="text-[13px] font-semibold text-text">{t('message')}</span>
          <textarea
            name="message"
            rows={4}
            maxLength={2000}
            className="rounded-xl border border-line bg-field px-3.5 py-2.5 text-[14px] text-text"
          />
        </label>
      </fieldset>

      {failure ? (
        <p role="alert" className="text-[13px] text-bad">
          {failure}
        </p>
      ) : null}

      <p className="text-[12px] leading-relaxed text-faint">{t('privacy')}</p>

      <button
        type="submit"
        disabled={busy}
        className="min-h-11 w-fit cursor-pointer rounded-xl bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-6 text-[14px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}

/**
 * One labelled input.
 *
 * No `dir` — see the note at the top of this file, and docs/i18n.md §9. The email and the website
 * are Latin RUNS inside an RTL field, which the bidi algorithm lays out correctly without being
 * told; `dir="ltr"` would move the caret to the wrong edge of the box.
 */
function Field({
  name,
  label,
  hint,
  error,
  type = 'text',
  autoComplete,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly type?: string;
  readonly autoComplete?: string;
}) {
  const describedBy = hint ? `${name}-hint` : undefined;

  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-semibold text-text">{label}</span>
      {hint ? (
        <span id={describedBy} className="text-[12px] text-faint">
          {hint}
        </span>
      ) : null}
      <input
        name={name}
        type={type}
        {...(autoComplete ? { autoComplete } : {})}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        aria-invalid={error ? true : undefined}
        className="min-h-11 rounded-xl border border-line bg-field px-3.5 text-[14px] text-text"
      />
      {error ? (
        <span role="alert" className="text-[12px] text-bad">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Select({
  name,
  label,
  options,
  placeholder,
  defaultValue,
  error,
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly { value: string; label: string }[];
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly error?: string | undefined;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-semibold text-text">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ''}
        aria-invalid={error ? true : undefined}
        className="min-h-11 cursor-pointer rounded-xl border border-line bg-field px-3.5 text-[14px] text-text"
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-[12px] text-bad">
          {error}
        </span>
      ) : null}
    </label>
  );
}
