import type { Metadata } from 'next';

import { ThemeScript } from '@/components/theme-script';
import { t } from '@/lib/strings';

import './globals.css';

/**
 * `noindex` at the document level as well as in the headers.
 *
 * Belt and braces on purpose: a crawler that ignores one usually honours the other,
 * and there is no version of this app that should ever appear in a search result.
 */
export const metadata: Metadata = {
  title: t.meta.title,
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * `lang="ar" dir="rtl"` on the document, not per component.
   *
   * Direction has to be set here or every logical property in the tree resolves the
   * wrong way — `pe-11` on the password field would pad the left, putting the eye over
   * the start of the text. `lang` matters too: it selects Arabic glyph forms and tells a
   * screen reader which language to speak.
   */
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/*
          Before anything paints. `<head>` rather than the top of `<body>` so the attribute is
          on `<html>` while the first stylesheet is still being applied — in `<body>` the dark
          background has already been painted and the light theme arrives as a visible flash.
        */}
        <ThemeScript />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
