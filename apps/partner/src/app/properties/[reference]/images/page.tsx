import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPropertyImages, sidebarBadges } from '@/lib/api';
import { ImageManager } from '@/components/image-manager';
import { requireVerifiedPartner } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { t } from '@/lib/strings';

/**
 * صور العقار (§5.6's gallery, managed).
 *
 * Reached from the listing card. The API scopes every read and write to the `partnerId` in the
 * verified token and answers 404 for another partner's reference, so a partner pasting somebody
 * else's reference into this URL gets not-found — this page does no checking of its own, because
 * a check here would be a second opinion about a question only the API is entitled to answer.
 */
export const dynamic = 'force-dynamic';

export default async function PropertyImagesPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  const [profile, images] = await Promise.all([
    requireVerifiedPartner(),
    getPropertyImages(reference),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (images === 'unauthenticated') {
    return (
      <Shell
        title={t.images.title}
        partnerName={name}
        active="properties"
        badges={sidebarBadges(profile)}
      >
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  /* Unknown, or another partner's. The same answer either way, deliberately. */
  if (images === 'failed') notFound();

  return (
    <Shell
      title={t.images.title}
      partnerName={name}
      active="properties"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">
        <Link
          href="/properties"
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-line px-3 text-[12.5px] text-muted lg:min-h-0 lg:py-1.5"
        >
          {/* The arrow is its own flex item so `dir="rtl"` places it, not the bidi algorithm. */}
          <span aria-hidden="true">→</span>
          {t.images.backToProperties}
        </Link>

        <ImageManager reference={reference} images={images} />
      </div>
    </Shell>
  );
}
