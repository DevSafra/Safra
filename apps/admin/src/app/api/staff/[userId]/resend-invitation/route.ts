import { proxy } from '@/lib/proxy';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  return proxy(`/admin/staff/${encodeURIComponent(userId)}/resend-invitation`, {
    method: 'POST',
  });
}
