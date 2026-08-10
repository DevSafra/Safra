'use client';

import { applySidebar } from './sidebar.js';

export interface SidebarBackdropProps {
  /** The dismiss label — the same "hide the navigation" string the hamburger uses. */
  readonly label: string;
  /**
   * The app's backdrop class.
   *
   * A prop because each app's `globals.css` owns WHEN the backdrop is visible — below `lg`, and
   * only while the sidebar is shown — and the class is that rule's hook. The styling cannot come
   * from here: it depends on an attribute on `<html>` and must be right in the first painted
   * frame, which a Tailwind arbitrary variant repeated per element cannot express legibly.
   */
  readonly className: string;
}

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
export function SidebarBackdrop({ label, className }: SidebarBackdropProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`${className} cursor-pointer`}
      onClick={() => applySidebar('hidden')}
    />
  );
}
