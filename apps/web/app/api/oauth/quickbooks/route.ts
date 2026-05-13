/**
 * QuickBooks OAuth initiation.
 *
 * GET /api/oauth/quickbooks?phone=<tenant_phone>
 *   → redirects to Intuit authorize URL with phone embedded in state
 *
 * Required env:
 *   - QUICKBOOKS_CLIENT_ID
 *   - QUICKBOOKS_CLIENT_SECRET
 *   - NEXT_PUBLIC_APP_BASE_URL
 *   - API_AUTH_SECRET
 */

import { signSessionToken } from '../../_lib/api-auth';
import { buildQuickBooksAuthorizeUrl } from '../../_lib/integrations/quickbooks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return new Response('phone required', { status: 400 });
  if (!process.env.QUICKBOOKS_CLIENT_ID) {
    return new Response('QUICKBOOKS_CLIENT_ID not configured', { status: 503 });
  }
  const state = await signSessionToken(phone);
  return Response.redirect(buildQuickBooksAuthorizeUrl(state), 302);
}
