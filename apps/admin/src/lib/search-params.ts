/**
 * Reads the two query parameters every registry page shares.
 *
 * Next gives `searchParams` as `string | string[] | undefined` because a URL can legitimately
 * repeat a key. Taking the FIRST value is the right reading here: `?q=a&q=b` is either a bug or
 * somebody probing, and neither deserves an array reaching a SQL `LIKE`.
 *
 * Trimmed, and an empty string collapses to `undefined` so the API never receives `?q=` — which
 * its `.strict()` schema would reject with a 400 and turn a stray submit into an error page.
 */
export async function listParams(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<{ q: string | undefined; cursor: string | undefined }> {
  const params = await searchParams;

  const first = (key: string): string | undefined => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value?.trim() || undefined;
  };

  return { q: first('q'), cursor: first('cursor') };
}
