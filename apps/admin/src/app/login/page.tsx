import { safeRedirect } from '@safra/session';

import { StaffLoginForm } from '@/components/staff-login-form';
import { AR } from '@/lib/strings';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  /**
   * Validated here, not trusted from the query string.
   *
   * `safeRedirect` is the same guard the public app uses — a sign-in form is the one
   * place an open redirect is most worth exploiting, because the page around it is
   * genuinely SAFRA's. There is no locale segment in this app, so the fallback is the
   * dashboard root.
   */
  const next = safeRedirect(query['next'], '');

  return (
    <main className="mx-auto grid min-h-screen max-w-sm place-content-center px-4">
      <div className="w-full">
        <p className="text-3xl text-gold" aria-hidden>
          ۞
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-text">{AR.login.title}</h1>
        <p className="mt-1 text-sm text-muted">{AR.login.subtitle}</p>

        <div className="mt-8 rounded-xl border border-line bg-card p-6">
          <StaffLoginForm next={next === '/' ? '/' : next} />
        </div>
      </div>
    </main>
  );
}
