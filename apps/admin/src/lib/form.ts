/**
 * Reads a form field as text.
 *
 * `FormData.get` returns `string | File | null`, so `String(form.get(name))` yields
 * "[object File]" for a file input and "null" for a missing one — either of which
 * would be posted verbatim as if it were what the user typed. Narrowing first means
 * an unexpected shape becomes an empty string and fails validation visibly.
 */
export function text(form: FormData, name: string): string {
  const value = form.get(name);

  return typeof value === 'string' ? value : '';
}
