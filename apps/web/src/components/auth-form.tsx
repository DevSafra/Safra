'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PasswordField, PasswordStrengthMeter, passwordsMatch } from '@safra/ui';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';
import { PhoneField } from '@/components/phone-field';
import { reloadInto } from '@safra/ui';
import { errorMessage } from '@safra/i18n';
import { isErrorCode, phoneSchema } from '@safra/contracts';

interface FieldErrors {
  [field: string]: string | undefined;
}

/**
 * Sign in and register, in one component (SRS §4).
 *
 * One component rather than two because the two forms differ only in which inputs
 * they show and which endpoint they post to — everything that is actually tricky
 * (inline field errors keyed by the shared Zod schema's paths, a disabled button
 * during submission, redirecting back to where the customer came from) is identical,
 * and duplicating it is how the two drift apart.
 *
 * Posts to a Next route handler, never to the API: the tokens go straight into an
 * HttpOnly cookie server-side, so no access token ever exists in client JavaScript.
 */
export function AuthForm({
  locale,
  mode,
  redirectTo,
}: {
  locale: Locale;
  mode: 'login' | 'register';
  /**
   * Where to go after signing in. Already validated server-side to be a path on
   * this site — see `safeRedirect` in the page. An unchecked value here would be an
   * open redirect on the one form most worth phishing.
   */
  redirectTo: string;
}) {
  const t = useTranslations('auth');

  /*
    Held so the strength meter can classify it as it is typed.

    In STATE rather than read from the DOM, because the meter re-renders on every keystroke and
    React is what drives that. It is never persisted, never put in a ref that outlives the form and
    never sent separately — submission still reads `FormData`, exactly as before.
  */
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** Registration succeeded — the same screen whether or not the address was already taken. */
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);

    /*
      Registration only. Signing in has one password field, and asking somebody to type an existing
      password twice would be friction with nothing to catch.

      Reported against the confirmation FIELD rather than as a form-level banner, which is what the
      other three forms do — `fieldErrors` already drives `PasswordField`'s `error` slot, so the
      message lands on the input that has the problem and sets `aria-invalid` on it.
    */
    if (
      mode === 'register' &&
      !passwordsMatch(text(form, 'password'), text(form, 'confirm'))
    ) {
      setFieldErrors({ confirm: t('passwordMismatch') });
      setSubmitting(false);

      return;
    }

    /*
      The phone, checked against the SAME schema the API uses.

      Not a copy of the rule — `phoneSchema` itself, so the client and the server can never
      disagree about what a valid number is. That matters more than the round trip it saves: two
      hand-written rules drift, and the one that drifts silently is the client's.

      This form is `noValidate`, so `required` marks the field for assistive technology and does
      not stop a submission — the same reason the password check above exists.

      The API's own code is resolved to the reader's language rather than replaced with a generic
      sentence: `phone_invalid` names the chosen country, which is the actionable part.
    */
    if (mode === 'register') {
      const phone = text(form, 'phone');

      if (phone === '') {
        setFieldErrors({ phone: t('phoneIncomplete') });
        setSubmitting(false);

        return;
      }

      const checked = phoneSchema.safeParse(phone);

      if (!checked.success) {
        const code = checked.error.issues[0]?.message;

        setFieldErrors({
          phone: isErrorCode(code) ? errorMessage(code, locale) : t('phoneIncomplete'),
        });
        setSubmitting(false);

        return;
      }
    }

    const body =
      mode === 'login'
        ? { email: text(form, 'email'), password: text(form, 'password') }
        : {
            email: text(form, 'email'),
            password: text(form, 'password'),
            fullName: text(form, 'fullName'),
            phone: text(form, 'phone'),
            gender: text(form, 'gender'),
            preferredLocale: locale,
          };

    try {
      const response = await fetch(`/${locale}/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        applyError(await response.json().catch(() => null), response.status, {
          setFormError,
          setFieldErrors,
          t,
          locale,
        });
        setSubmitting(false);
        return;
      }

      /**
       * `refresh()` before `push()`, and both are needed.
       *
       * The session lives in an HttpOnly cookie the client cannot see, so nothing in
       * the React tree knows it changed. Without the refresh, the server components
       * that render the header and the account page are served from the router cache
       * and still believe the customer is signed out.
       */
      /*
        Registration no longer signs anybody in — it answers the same generic body for every
        address, so it cannot carry a session (see the route handler). Both paths end here, at
        "check your email", which is what makes a taken address indistinguishable from a new one
        to whoever is looking at the screen.
      */
      if (mode === 'register') {
        setSent(true);
        setSubmitting(false);
        return;
      }

      /*
        A full document load, not `router.push`. The header is server-rendered from the session cookie,
        and the router cache may hold a copy of the destination made while nobody was signed in — see
        `reloadInto`.
      */
      reloadInto(redirectTo);
    } catch {
      setFormError(t('networkError'));
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-card border border-ok/40 bg-ok/10 p-4">
        <p className="font-display text-lg text-ok">{t('checkEmail')}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('checkEmailBody')}</p>
        <Link
          href={`/${locale}/login`}
          className="mt-4 inline-flex min-h-10 items-center text-sm text-gold-ink underline-offset-4 hover:underline"
        >
          {t('backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="flex flex-col gap-4"
    >
      {formError ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {formError}
        </p>
      ) : null}

      {mode === 'register' ? (
        <Field
          name="fullName"
          label={t('fullName')}
          autoComplete="name"
          error={fieldErrors['fullName']}
          required
        />
      ) : null}

      <Field
        name="email"
        type="email"
        label={t('email')}
        autoComplete="email"
        inputMode="email"
        error={fieldErrors['email']}
        required
      />

      {/*
        Required (Bashar, 2026-08-14) — a choice must be made, and «أفضّل عدم الإفصاح» is one of the
        choices rather than a way of leaving it blank.

        The empty option is kept and `required` is set on the select, so the field starts with
        nothing pre-selected and the browser refuses to submit until something is picked. Defaulting
        to a value instead would record an answer nobody gave, which is the failure a required field
        is supposed to prevent — and `disabled` on the placeholder stops it being chosen back.
      */}
      {mode === 'register' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="field-gender" className="text-sm text-muted">
            {t('gender')} <span className="text-gold-ink">*</span>
          </label>
          <select
            id="field-gender"
            name="gender"
            defaultValue=""
            required
            aria-invalid={fieldErrors['gender'] ? 'true' : undefined}
            className={`min-h-10 cursor-pointer rounded-lg border bg-field px-3 py-2.5 text-text lg:min-h-0 ${
              fieldErrors['gender'] ? 'border-bad' : 'border-line'
            }`}
          >
            <option value="" disabled>
              {t('genderChoose')}
            </option>
            <option value="male">{t('genderMale')}</option>
            <option value="female">{t('genderFemale')}</option>
            <option value="undisclosed">{t('genderUndisclosed')}</option>
          </select>
          {fieldErrors['gender'] ? (
            <span className="text-xs text-bad">{fieldErrors['gender']}</span>
          ) : null}
        </div>
      ) : null}

      {mode === 'register' ? (
        <PhoneField
          locale={locale}
          label={t('phone')}
          hint={t('phoneHint')}
          error={fieldErrors['phone']}
        />
      ) : null}

      <PasswordField
        name="password"
        showLabel={t('showPassword')}
        hideLabel={t('hidePassword')}
        label={t('password')}
        showRequiredMark
        // "new-password" tells a password manager to OFFER one on registration and
        // not to autofill the existing one; "current-password" does the opposite.
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        error={fieldErrors['password']}
        required
        onChange={(event) => setPassword(event.target.value)}
      />

      {/*
        The live checklist, on REGISTRATION only.
        
        On sign-in it would be noise at best and a hint at worst: the password already exists, the
        rules cannot change it, and drawing attention to which ones it fails would tell whoever is
        looking at the screen something about somebody else's password.
      */}
      {mode === 'register' ? (
        <PasswordStrengthMeter
          password={password}
          progressLabel={t('strength')}
          labels={{
            length: t('ruleLength'),
            uppercase: t('ruleUppercase'),
            lowercase: t('ruleLowercase'),
            digit: t('ruleDigit'),
            symbol: t('ruleSymbol'),
          }}
        />
      ) : null}

      {/*
        Register only, and never sent: `registerSchema` takes one password, and a second field would
        be refused by a strict schema rather than ignored. The confirmation is a typo guard, and a
        typo here costs an account somebody cannot sign in to.
      */}
      {mode === 'register' ? (
        <PasswordField
          name="confirm"
          showLabel={t('showPassword')}
          hideLabel={t('hidePassword')}
          label={t('confirmPassword')}
          showRequiredMark
          autoComplete="new-password"
          error={fieldErrors['confirm']}
          required
        />
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 w-full rounded-lg btn-gold px-5 py-3 font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t('submitting') : t(mode === 'login' ? 'signIn' : 'createAccount')}
      </button>
    </form>
  );
}

/**
 * `FormData.get` returns `string | File`, so coercing with String() would post a file
 * input as the literal "[object File]". Anything that is not a string is treated as
 * absent and the schema rejects it.
 */
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function Field({
  name,
  label,
  error,
  hint,
  ...rest
}: {
  name: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  /*
    A phone number, an email or a URL is laid out LEFT TO RIGHT whatever the page reads.

    `field-ltr` sets the direction and takes the ALIGNMENT from the document rather than from the
    element, so the value still sits at the reader's start edge — the right, in Arabic. `dir="ltr"`
    alone fixes the order and breaks the placement: the value goes flush left inside a full-width
    field while its own label sits on the right. Reported by Bashar against البريد الإلكتروني and
    رقم الهاتف (2026-08-11); the profile form was fixed then and this shared `Field` was not, which
    is why the checkout and registration phone fields still had it (2026-08-13).
  */
  const latinValue = rest.type === 'tel' || rest.type === 'email' || rest.type === 'url';

  const id = `field-${name}`;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label} <span className="text-gold-ink">*</span>
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-lg border bg-field px-3 py-2.5 text-text ${
          error ? 'border-bad' : 'border-line'
        } ${latinValue ? 'field-ltr' : ''}`}
        {...rest}
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-faint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Turns an API failure into something the customer can act on.
 *
 * The 401 case is deliberately vague, and that is the API's design showing through:
 * login answers identically for an unknown email and a wrong password so the form
 * cannot be used to enumerate accounts. Registration is the opposite — a 409 says
 * plainly that the address is taken, because a signup form reveals that anyway by
 * refusing to proceed (ADR 0003).
 */
function applyError(
  body: unknown,
  status: number,
  handlers: {
    setFormError: (message: string) => void;
    setFieldErrors: (errors: FieldErrors) => void;
    t: ReturnType<typeof useTranslations<'auth'>>;
    /** The reader's locale — the API answers with codes, and this is what resolves them. */
    locale: Locale;
  },
): void {
  const { setFormError, setFieldErrors, t, locale } = handlers;

  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;

    if (Array.isArray(record['errors'])) {
      const mapped: FieldErrors = {};

      for (const entry of record['errors']) {
        if (typeof entry === 'object' && entry !== null && 'field' in entry) {
          const item = entry as { field?: unknown; code?: unknown; params?: unknown };
          if (typeof item.field === 'string') {
            /*
              Read `code`, never `message`.

              `message` is the English text the API sends for logs and for clients that have not
              been taught the codes. This line used to write it straight into the error under the
              input, which made the one place on the page where wording matters most the one
              place that ignored the reader's language.
            */
            /*
              The PARAMS travel with the code, and the message is nothing without them.

              Seventeen catalogue entries interpolate a value. Resolving one without it printed the
              placeholder to the reader — «يجب أن تكون كلمة المرور {min} أحرف على الأقل.» on this
              very form (Bashar, 2026-08-14). The API now sends them; this passes them on.
            */
            mapped[item.field] = errorMessage(
              typeof item.code === 'string' ? item.code : null,
              locale,
              asParams(item.params),
            );
          }
        }
      }

      if (Object.keys(mapped).length > 0) {
        setFieldErrors(mapped);
        setFormError(t('fixFields'));
        return;
      }
    }
  }

  /*
    The CODE first, the status only as a fallback.

    Matching on status alone is what this did before, and it is too coarse to be honest: every
    401 said "email or password is wrong", including the one that really meant "your
    authenticator code is required" and the one that meant "this account is locked". Somebody
    typing a correct password was told it was wrong. The code says which it is, so it wins; the
    status remains the answer for a response that predates the codes or never had a body.
  */
  if (typeof body === 'object' && body !== null) {
    const code = (body as { code?: unknown }).code;

    if (isErrorCode(code)) {
      setFormError(
        errorMessage(code, locale, asParams((body as { params?: unknown }).params)),
      );
      return;
    }
  }

  if (status === 401) {
    setFormError(t('badCredentials'));
    return;
  }

  if (status === 409) {
    setFormError(t('emailTaken'));
    return;
  }

  if (status === 423) {
    setFormError(t('locked'));
    return;
  }

  if (status === 429) {
    setFormError(t('tooManyAttempts'));
    return;
  }

  setFormError(t('genericError'));
}

/**
 * The `params` an error body carries, narrowed to what `errorMessage` will interpolate.
 *
 * A response body is caller-supplied data, so this validates rather than casts: an object of
 * strings and numbers, or nothing. Anything else — a nested object, an array, a function smuggled
 * through some future serialiser — is dropped, and the message falls back to the generic one rather
 * than interpolating something unexpected into a sentence a person reads.
 */
function asParams(value: unknown): Record<string, string | number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;

  const params: Record<string, string | number> = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number') params[key] = item;
  }

  return Object.keys(params).length > 0 ? params : undefined;
}
