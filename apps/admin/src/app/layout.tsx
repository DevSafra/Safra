import { Amiri, IBM_Plex_Sans_Arabic } from 'next/font/google';
import type { Metadata } from 'next';

import './globals.css';

/**
 * IBM Plex Sans Arabic — the design handoff's UI face (§4.1), self-hosted by `next/font`.
 *
 * Was Cairo, which was a guess made before the handoff arrived. The two are not
 * interchangeable: Plex Arabic has noticeably tighter counters and a shorter x-height, so
 * the same 11.5px caption sets narrower and the 24px KPI figures sit differently against
 * their labels. Every spacing value in the handoff was measured against this face.
 *
 * Weights 300–700, matching the handoff's Google Fonts request. Self-hosted means no runtime
 * request to Google, which the Content-Security-Policy would block anyway.
 */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
});

/**
 * Amiri for display headings, as the design does.
 *
 * A naskh face for display text and Plex Arabic for UI — the same pairing the design uses
 * throughout, so the console reads as part of SAFRA rather than an unrelated admin tool.
 * Only two weights exist in the design's request, and only 400 is used here.
 */
const amiri = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-amiri',
  display: 'swap',
});

/**
 * `noindex` at the document level as well as in the headers.
 *
 * Belt and braces on purpose: a crawler that ignores one usually honours the other,
 * and there is no version of this app that should ever appear in a search result.
 */
export const metadata: Metadata = {
  title: 'سفرة — مركز القيادة',
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
    <html lang="ar" dir="rtl" className={`${plex.variable} ${amiri.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-plex)]">{children}</body>
    </html>
  );
}
