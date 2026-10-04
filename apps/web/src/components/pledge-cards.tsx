import { CompensationIcon, VerifiedIcon, WalletIcon } from '@/components/icons';

/**
 * SAFRA's three pledges as cards: the home page's «عهود سفرة», and «عن سفرة» since 2026-10-04.
 *
 * One component for both, because a promise worded or drawn differently on two pages is two
 * promises. The icons are fixed to the pledge they belong to, in order (Bashar, 2026-09-03): a
 * shield, a badge and a returning arrow say which promise this is before the heading is read.
 */
const ICONS = [VerifiedIcon, CompensationIcon, WalletIcon] as const;

export interface Pledge {
  readonly ordinal: string;
  readonly title: string;
  readonly body: string;
}

export function PledgeCards({
  pledges,
}: {
  readonly pledges: readonly [Pledge, Pledge, Pledge];
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-3">
      {pledges.map((pledge, index) => {
        const Icon = ICONS[index]!;
        return (
          <li
            key={pledge.title}
            className="rounded-card border border-line bg-card p-5 text-center"
          >
            <span
              aria-hidden
              className="inline-flex size-11 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold-read [&_svg]:size-5"
            >
              <Icon />
            </span>
            <p className="mt-3 text-14 tracking-wide text-faint">{pledge.ordinal}</p>
            <h3 className="mt-1 text-lg font-bold text-balance text-text">
              {pledge.title}
            </h3>
            <div className="gold-rule mx-auto mt-3 w-12" />
            <p className="mt-3 text-14 leading-relaxed text-muted">{pledge.body}</p>
          </li>
        );
      })}
    </ul>
  );
}
