import { describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';

import { errorFromBody, errorMessage, errorParams } from './errors.js';
import { ar } from './messages/errors/ar.js';

/**
 * A refusal that names a limit must SAY the limit.
 *
 * ## The bug
 *
 * Bashar hit «حدث خطأ ما. حاول مرة أخرى.» replacing a dispute photograph on 2026-08-30. The API
 * had answered precisely — `upload.image_too_small` with `params: { min: 400 }` — and every reader
 * in every app resolved the CODE and dropped the PARAMS. `errorMessage` then found a template
 * carrying `{min}`, could not fill it, and correctly refused to print a surviving placeholder,
 * falling back to the generic sentence.
 *
 * Twenty-six messages were unreachable that way. Nothing failed: the screen showed Arabic, just
 * the wrong Arabic, and each app had written its own two-line extraction that looked right.
 */
describe('a parameterised refusal reaches the reader', () => {
  /** Every message in the catalogue that carries a placeholder — the set that was unreachable. */
  const parameterised = Object.entries(ar).filter(([, message]) =>
    /\{\w+\}/.test(message ?? ''),
  );

  it('has messages that need parameters at all', () => {
    /* If this ever reaches zero the rest of the file is vacuous — see `no-bare-amounts`. */
    expect(parameterised.length).toBeGreaterThan(20);
  });

  it('falls back to the generic sentence when the values are missing', () => {
    for (const [code, message] of parameterised) {
      const withoutValues = errorMessage(code, 'ar');

      expect(withoutValues, `${code} printed a raw placeholder`).not.toMatch(/\{\w+\}/);
      expect(withoutValues, `${code} should fall back without values`).not.toBe(message);
    }
  });

  /** The fix, at the shape the API actually sends. */
  it('fills the placeholder from the response body', () => {
    const body = {
      statusCode: 400,
      code: ERROR.UPLOAD_IMAGE_TOO_SMALL,
      message: 'Images must be at least 400x400 pixels.',
      params: { min: 400 },
    };

    const shown = errorFromBody(body, 'ar');

    expect(shown).toContain('400');
    expect(shown).not.toBe(errorMessage(null, 'ar'));
    expect(shown).not.toMatch(/\{\w+\}/);
  });

  it('reads a code with no params, and a body with neither', () => {
    expect(errorFromBody({ code: ERROR.DISPUTE_NOT_FOUND }, 'ar')).toBe(
      errorMessage(ERROR.DISPUTE_NOT_FOUND, 'ar'),
    );
    expect(errorFromBody(null, 'ar')).toBe(errorMessage(null, 'ar'));
    expect(errorFromBody({ statusCode: 500 }, 'ar')).toBe(errorMessage(null, 'ar'));
  });

  /**
   * The body is not ours to trust in shape.
   *
   * A nested object or an array substituted into a template renders as `[object Object]`, which is
   * worse than the generic sentence: it looks like a bug in the product rather than a refusal.
   */
  it('takes only strings and numbers out of a body', () => {
    expect(errorParams({ params: { min: 400, unit: 'px' } })).toEqual({
      min: 400,
      unit: 'px',
    });
    expect(errorParams({ params: { nested: { min: 4 } } })).toBeUndefined();
    expect(errorParams({ params: [1, 2] })).toBeUndefined();
    expect(errorParams({ params: 'nope' })).toBeUndefined();
    expect(errorParams({})).toBeUndefined();
    expect(errorParams(null)).toBeUndefined();
  });
});
