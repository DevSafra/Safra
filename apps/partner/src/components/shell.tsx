import Link from 'next/link';

import { t } from '@/lib/strings';

/**
 * The two-column shell from the design handoff §7: a 220px sidebar and the section beside it.
 *
 * ## Content before navigation
 *
 * The `<main>` comes FIRST in the DOM and is placed into column one with
 * `lg:col-start-1 lg:row-start-1`, exactly as the console does. On a phone the layout collapses to
 * one column, and a partner opening their dashboard should land on their listings rather than on
 * a list of three nav links.
 */
export function Shell({
  title,
  partnerName,
  active,
  children,
}: {
  readonly title: string;
  readonly partnerName: string;
  readonly active: 'dashboard' | 'properties' | 'payouts' | 'reviews';
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-[1380px] gap-5 px-6 pt-6 pb-16 lg:grid-cols-[220px_1fr] lg:items-start">
      <main className="min-w-0 lg:col-start-2 lg:row-start-1">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-[family-name:var(--font-amiri)] text-[28px] font-bold text-gold">
            {title}
          </h1>
          <p className="text-[12.5px] text-muted">{partnerName}</p>
        </header>

        {children}
      </main>

      <aside className="rounded-[14px] border border-[rgba(var(--goldA),0.14)] bg-card p-3.5 lg:col-start-1 lg:row-start-1 lg:sticky lg:top-6">
        <p className="mb-2 px-2 text-[11px] tracking-wide text-faint">{partnerName}</p>

        <nav aria-label={t.nav.heading} className="grid gap-0.5">
          <Item href="/" label={t.nav.dashboard} current={active === 'dashboard'} />
          <Item
            href="/properties"
            label={t.nav.properties}
            current={active === 'properties'}
          />
          <Item href="/payouts" label={t.nav.payouts} current={active === 'payouts'} />
          <Item href="/reviews" label={t.nav.reviews} current={active === 'reviews'} />
        </nav>

        <p className="mt-3 border-t border-line px-2 pt-3 text-[11px] text-faint">
          {t.nav.support}
        </p>

        {/*
          Sign out lives at the FOOT of the sidebar, not in the page header — the same decision the
          console records: a phone cannot hold a title, a name and a sign-out button on one line.
        */}
        <form action="/api/auth/logout" method="post" className="mt-3">
          <button
            type="submit"
            className="w-full cursor-pointer rounded-lg border border-line px-2.5 py-2 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold"
          >
            {t.nav.signOut}
          </button>
        </form>
      </aside>
    </div>
  );
}

function Item({
  href,
  label,
  current,
}: {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
}) {
  return (
    <Link
      href={href}
      {...(current ? { 'aria-current': 'page' as const } : {})}
      className={`flex min-h-10 items-center rounded-lg px-2.5 py-2 text-[13px] transition-colors lg:min-h-0 ${
        current
          ? 'bg-[rgba(var(--goldA),0.12)] font-extrabold text-gold'
          : 'text-muted hover:bg-line2'
      }`}
    >
      {label}
    </Link>
  );
}
