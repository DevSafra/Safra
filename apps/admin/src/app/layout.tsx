import type { Metadata } from 'next';

import './globals.css';

/**
 * `noindex` at the document level as well as in the headers.
 *
 * Belt and braces on purpose: a crawler that ignores one usually honours the other,
 * and there is no version of this app that should ever appear in a search result.
 */
export const metadata: Metadata = {
  title: 'SAFRA — Command Center',
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
