'use client';

import { useEffect, useState } from 'react';

import { applySidebar, sidebarVisible } from '@safra/ui';

import { SIDEBAR_ID, t } from '@/lib/strings';

/**
 * The hamburger. Available at every width (Bashar, 2026-08-05).
 *
 * ## Why it is available on a desktop too
 *
 * The usual pattern hides the toggle from `lg` up and pins the sidebar open. That decides for the
 * operator: a registry table is eight columns of Arabic, and 220px back is a visible difference on
 * a 1280px laptop. The requirement is that the person chooses, at any size.
 *
 * ## State lives on `<html>`, not here
 *
 * `PreferencesScript` has already applied the saved value before this mounts, and the CSS in
 * `globals.css` draws the layout from it. This component reads that state so its label and
 * `aria-expanded` describe what is actually on screen, and writes it on click.
 *
 * The first render deliberately assumes visible. There is nothing to read during server
 * rendering — the choice lives in `localStorage` — and branching on anything client-only here is
 * a hydration mismatch, which this console has been broken by before. The effect corrects it
 * before a person can act on it.
 */
export function SidebarToggle() {
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
    const media = window.matchMedia('(min-width: 64rem)');
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
      if (window.matchMedia('(min-width: 64rem)').matches) return;

      applySidebar('hidden');
      setVisible(false);
      // Focus returns to the control that opened it, or it is lost to the top of the document.
      document.getElementById(TOGGLE_ID)?.focus();
    }

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible]);

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
    if (next && !window.matchMedia('(min-width: 64rem)').matches) {
      requestAnimationFrame(() => {
        document.getElementById(SIDEBAR_ID)?.focus();
      });
    }
  }

  const label = visible ? t.nav.hideSidebar : t.nav.showSidebar;

  return (
    <button
      id={TOGGLE_ID}
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-expanded={visible}
      aria-controls={SIDEBAR_ID}
      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-[9px] border border-line bg-field text-muted transition-colors hover:border-gold hover:text-gold"
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

/** Stable id so `aria-controls` and the focus calls agree. */
const TOGGLE_ID = 'sidebar-toggle';
