import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ERROR } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

import { ZodValidationPipe } from './zod-validation.pipe.js';

/**
 * What a failed validation tells the client.
 *
 * ## The bug this exists to keep fixed
 *
 * The registration form showed «يجب أن تكون كلمة المرور {min} أحرف على الأقل.» — the placeholder,
 * not the number (Bashar, 2026-08-14). The schema knows the bound is 12 and the catalogue knows the
 * sentence, and nothing joined them: the pipe sent `{ field, code, message }` and the client
 * resolved the code in Arabic with no value to interpolate.
 *
 * Zod already puts the bound on the issue, so the join is derivation rather than a second mapping
 * of code to parameters — which would be a third place to update whenever a bound changes, with a
 * `{min}` on somebody's screen as the failure mode.
 */
const body = (schema: z.ZodType<unknown>, value: unknown) => {
  try {
    new ZodValidationPipe(schema).transform(value);
  } catch (error) {
    return (error as { getResponse(): Record<string, unknown> }).getResponse();
  }

  throw new Error('The schema accepted a value the test expected it to refuse.');
};

/**
 * The first issue, or a failure.
 *
 * Asserted rather than optional-chained: a test that silently proceeded with `undefined` would
 * report a missing `params` as a failure of the pipe, when what actually happened is that the
 * schema accepted the value.
 */
const first = (schema: z.ZodType<unknown>, value: unknown) => {
  const errors = body(schema, value)['errors'] as {
    code: string;
    message: string;
    params?: Record<string, number>;
  }[];
  const issue = errors[0];

  if (!issue) throw new Error('The pipe reported no field errors.');

  return issue;
};

describe('the validation pipe', () => {
  const password = z.object({
    password: z
      .string()
      .min(12, ERROR.VALIDATION_PASSWORD_TOO_SHORT)
      .max(256, ERROR.VALIDATION_PASSWORD_TOO_LONG),
  });

  it('sends the lower bound with a too-short value', () => {
    const issue = first(password, { password: 'short' });

    expect(issue.code).toBe(ERROR.VALIDATION_PASSWORD_TOO_SHORT);
    expect(issue.params).toEqual({ min: 12 });
  });

  it('sends the upper bound with a too-long value', () => {
    const issue = first(password, { password: 'x'.repeat(300) });

    expect(issue.code).toBe(ERROR.VALIDATION_PASSWORD_TOO_LONG);
    expect(issue.params).toEqual({ max: 256 });
  });

  /**
   * The whole point, end to end: what the client can now render.
   *
   * Asserted through `errorMessage` rather than on the shape alone, because the shape being right
   * and the sentence still saying `{min}` is exactly the state this shipped in.
   */
  it('carries enough for the client to render the real sentence', () => {
    const issue = first(password, { password: 'short' });

    const arabic = errorMessage(issue.code, 'ar', issue.params);

    expect(arabic).toContain('12');
    expect(arabic).not.toContain('{');
  });

  /** The API's own English message is filled too — it was `{min}` in the logs as well. */
  it('fills the English message it sends alongside', () => {
    const issue = first(password, { password: 'short' });

    expect(issue.message).toContain('12');
    expect(issue.message).not.toContain('{');
  });

  /* A constraint with no bound carries no parameters, and must not invent an empty object. */
  it('omits params where there are none', () => {
    const email = z.object({ email: z.string().email(ERROR.VALIDATION_EMAIL_INVALID) });
    const issue = first(email, { email: 'not-an-email' });

    expect(issue.code).toBe(ERROR.VALIDATION_EMAIL_INVALID);
    expect(issue.params).toBeUndefined();
  });
});
