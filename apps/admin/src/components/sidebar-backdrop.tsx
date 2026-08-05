'use client';

import { applySidebar } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * The dimmed area behind the sidebar when it is a drawer.
 *
 * Only visible below `lg`, and only when the sidebar is shown — `globals.css` owns both
 * conditions, so this renders unconditionally and costs nothing when the sidebar is a column.
 *
 * ## Why it is a button
 *
 * Tapping outside a drawer to dismiss it is what everyone expects from a phone, and a `div` with
 * an `onClick` gives that to a mouse and to nobody else. A `button` is reachable by keyboard and
 * announced, which matters because it is the only affordance a drawer offers besides the hamburger.
 * Escape does the same thing — see `SidebarToggle`.
 *
 * Dismissing is a DOM write and nothing more. No `router.refresh()`: the state is an attribute on
 * `<html>`, and re-rendering the server tree to close a drawer would refetch the page's data. The
 * hamburger keeps its label in step by observing the attribute.
 */
export function SidebarBackdrop() {
  return (
    <button
      type="button"
      aria-label={t.nav.hideSidebar}
      className="console-backdrop cursor-pointer"
      onClick={() => applySidebar('hidden')}
    />
  );
}
