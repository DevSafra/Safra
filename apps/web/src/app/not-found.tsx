import Link from 'next/link';

/**
 * Root-level 404. Deliberately locale-free: a request that never matched a locale
 * segment has no language context, so this stays minimal and bilingual.
 */
export default function NotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#0C0A1C',
          color: '#F4EEDF',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: '#E8BC66', fontSize: '2rem', margin: 0 }}>۞</p>
          <h1 style={{ fontSize: '1.25rem', marginTop: '1rem' }}>الصفحة غير موجودة</h1>
          <p style={{ color: '#A9A3C4', fontSize: '0.9rem' }}>Page not found</p>
          <Link
            href="/ar"
            style={{ color: '#E8BC66', display: 'inline-block', marginTop: '1rem' }}
          >
            سفرة | SAFRA
          </Link>
        </div>
      </body>
    </html>
  );
}
