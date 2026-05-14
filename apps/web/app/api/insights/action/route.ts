/**
 * Story 3.7 — Insight approve/dismiss endpoint for the deck.
 *
 * The deck's Innovation page calls this when the owner clicks
 * Approve or Dismiss on a business_insight card. Auth via the
 * existing session cookie (requireOwnerAuth).
 *
 * Body: { id: string, action: 'approve' | 'dismiss' }
 */

import { NextResponse } from 'next/server';
import { requireOwnerAuth } from '../../_lib/api-auth';
import { setInsightStatus, getInsightById } from '../../_lib/business-insights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { id, action, phone } = await request.json().catch(() => ({}));
  if (!id || !action || !phone) {
    return NextResponse.json({ error: 'id, action, and phone required' }, { status: 400 });
  }
  if (action !== 'approve' && action !== 'dismiss') {
    return NextResponse.json({ error: 'action must be approve or dismiss' }, { status: 400 });
  }

  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');
  const denied = await requireOwnerAuth(request, cleanPhone);
  if (denied) return denied;

  const insight = await getInsightById(String(id), cleanPhone);
  if (!insight) return NextResponse.json({ error: 'insight not found' }, { status: 404 });

  const ok = await setInsightStatus(insight.id, action === 'approve' ? 'approved' : 'dismissed');
  if (!ok) return NextResponse.json({ error: 'update failed' }, { status: 500 });
  return NextResponse.json({ ok: true, status: action === 'approve' ? 'approved' : 'dismissed' });
}
