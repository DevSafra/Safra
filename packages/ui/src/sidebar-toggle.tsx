'use client';

import { useEffect, useState } from 'react';

import { applySidebar, sidebarVisible } from './sidebar.js';

/** The width from which the sidebar is a column rather than a drawer. Tailwind's `lg`. */
const COLUMN_BREAKPOINT = '(min-width: 64rem)';

/** The default toggle id. Both staff surfaces use it, and the browser tests select on it. */
const DEFAULT_TOGGLE_ID = 'sidebar-toggle';

export interface SidebarToggleProps {
  /**
   * The `aside`'s id — used for `aria-controls` and to move focus into the drawer.
   *
   * A prop rather than a constant here because the two apps name their own element:
   * `console-nav` and `partner-nav`. Passing it keeps `aria-controls` pointing at an id that
   * exists, which is invisible to everyone except the screen-reader user it was added for.
   */
  readonly sidebarId: string;
  /** Names the ACTION, so the label says which way the button goes. Never the current state. */
  readonly showLabel: string;
  readonly hideLabel: string;
  /** This document's own id for the button. Both apps take the default. */
  readonly id?: string;
}

/**
 * The hamburger. Available at every width (Bashar, 2026-08-05).
 *
 * ## Why it lives in `@safra/ui`
 *
 * Both staff surfaces need it, and the requirement is that they AGREE — the sidebar collapses at
 * every size, the hamburger is always available, the choice persists, Escape dismisses the drawer
 * and returns focus. That is a project rule rather than a nicety, which is the bar this package
 * sets for admission (see `PasswordField`). A copy in each app would have worked on the day and
 * drifted after it, and the drift would be in the a11y behaviour, where nobody looks.
 *
 * Copy comes in as props for the same reason `PasswordField` requires its labels: no user-facing
 * text is written inside a component, and a default would be wrong in some language.
 *
 * ## Why it is available on a desktop too
 *
 * The usual pattern hides the toggle from `lg` up and pins the sidebar open. That decides for the
 * operator: a registry table is eight columns of Arabic, and 220px back is a visible difference on
 * a 1280px laptop. The requirement is that the person chooses, at any size.
 *
 * ## State lives on `<html>`, not here
 *
 * The pre-paint script has already applied the saved value before this mounts, and each app's
 * `globals.css` draws the layout from it. This component reads that state so its label and
 * `aria-expanded` describe what is actually on screen, and writes it on click.
 *
 * The first render deliberately assumes visible. There is nothing to read during server
 * rendering — the choice lives in `localStorage` — and branching on anything client-only here is
 * a hydration mismatch, which the console has been broken by before. The effect corrects it
 * before a person can act on it.
 */
export function SidebarToggle({
  sidebarId,
  showLabel,
  hideLabel,
  id = DEFAULT_TOGGLE_ID,
}: SidebarToggleProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(sidebarVisible());

    /*
      The attribute is the single source of truth, and this component is not its only writer — the
      backdrop and Escape both change it. Observing it keeps the label and `aria-expanded` correct
      whoever wrote it, without lifting the state into a context or refreshing the route to
      re-render one button.
    */
    const observer = new MutationObserver(() => setVisible(sidebarVisible()));

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-sidebar'],
    });

    /*
      Also re-read on resize. With no explicit choice the visible state IS the breakpoint, so
      dragging a window across 1024px changes what is on screen without touching the attribute.
    */
    const media = window.matchMedia(COLUMN_BREAKPOINT);
    const onChange = () => setVisible(sidebarVisible());

    media.addEventListener('change', onChange);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', onChange);
    };
  }, []);

  /**
   * Escape closes the sidebar, and only when it is a DRAWER.
   *
   * On a desktop the sidebar is a column, not a modal, and Escape closing a column would be a
   * surprise — the key means "dismiss the thing over my content". Below `lg` it is over the
   * content, so it should go.
   */
  useEffect(() => {
    if (!visible) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (window.matchMedia(COLUMN_BREAKPOINT).matches) return;

      applySidebar('hidden');
      setVisible(false);
      // Focus returns to the control that opened it, or it is lost to the top of the document.
      document.getElementById(id)?.focus();
    }

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, id]);

  function toggle() {
    const next = !visible;

    setVisible(next);
    applySidebar(next ? 'shown' : 'hidden');

    /*
      Opening it as a drawer moves focus INTO it.

      A keyboard user who opens a panel over the content and is left at the button has to tab
      through nothing to reach it. On a desktop the sidebar is a column in the normal flow, so
      focus stays where it was and the tab order already leads there.
    */
    if (next && !window.matchMedia(COLUMN_BREAKPOINT).matches) {
      requestAnimationFrame(() => {
        document.getElementById(sidebarId)?.focus();
      });
    }
  }

  const label = visible ? hideLabel : showLabel;

  return (
    <button
      id={id}
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-expanded={visible}
      aria-controls={sidebarId}
      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg border border-line bg-field text-muted transition-colors hover:border-gold hover:text-gold"
    >
      {/*
        Drawn as three bars rather than set as text, so it is a glyph at an exact size instead of
        whatever the Arabic font renders for `☰`. `aria-hidden` because the button is already
        labelled — a screen reader announcing "hamburger" after the label is noise.
      */}
      <span aria-hidden className="grid w-4 gap-[3px]">
        <span className="h-[2px] rounded bg-current" />
        <span className="h-[2px] rounded bg-current" />
        <span className="h-[2px] rounded bg-current" />
      </span>
    </button>
  );
}
