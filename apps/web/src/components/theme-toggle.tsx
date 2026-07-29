'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type Theme = 'dark' | 'light';

/**
 * Theme toggle, matching the ☾ control in the approved prototype.
 *
 * Reads the DOM rather than holding its own source of truth: ThemeScript has
 * already applied the saved value before this mounts, so state is initialised from
 * what is actually on screen.
 */
export function ThemeToggle() {
  const t = useTranslations('nav');
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.dataset['theme'];
    if (current === 'light' || current === 'dark') {
      setTheme(current);
      return;
    }

    // No explicit choice yet — reflect what the OS preference is showing.
    setTheme(
      window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
    );
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset['theme'] = next;

    try {
      localStorage.setItem('safra-theme', next);
    } catch {
      // Preference simply will not persist in private browsing.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('theme')}
      title={t('theme')}
      className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-muted transition-colors hover:border-gold hover:text-gold"
    >
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  );
}
