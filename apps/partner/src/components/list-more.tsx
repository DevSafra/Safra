import Link from 'next/link';

import { showMoreQuery } from '@safra/contracts';
import { ShowMore } from '@safra/ui';

/**
 * The partner portal's twin of the customer app's `ListMore` (the button itself is shared, from
 * `@safra/ui`). The foot of every cursor list: «عرض المزيد» while there is more, and «العودة إلى الأول» once
 * the list has moved its window past the ceiling (see `@safra/contracts/show-more`).
 *
 * `path` is the list's own LITERAL route, written by the page, never read from the request, so the
 * only thing the URL can choose is how much of a known list to show.
 */
export function ListMore({
  path,
  cursor,
  shown,
  nextCursor,
  labels,
}: {
  readonly path: string;
  readonly cursor: string | undefined;
  readonly shown: number;
  readonly nextCursor: string | null;
  readonly labels: {
    readonly more: string;
    readonly loading: string;
    readonly first: string;
  };
}) {
  const query = showMoreQuery({ cursor, shown, nextCursor });

  if (query === null && !cursor) return null;

  return (
    <div>
      {query !== null ? (
        <ShowMore
          href={`${path}?${query}`}
          label={labels.more}
          loadingLabel={labels.loading}
        />
      ) : null}

      {cursor ? (
        <Link
          href={path}
          className="mt-3 inline-flex min-h-10 items-center text-sm text-muted underline-offset-4 transition-colors duration-150 ease-out hover:text-gold-read hover:underline lg:min-h-0"
        >
          {labels.first}
        </Link>
      ) : null}
    </div>
  );
}
