/**
 * Build a Google IntegrationContext from an OAuthConnection row, with
 * the token-refresh persistence hook bound. Use this in agent-tool
 * executors instead of constructing the ctx inline — that way every
 * Google adapter call benefits from refreshed-token persistence
 * without each callsite duplicating the wiring.
 *
 * Snake-case (DB row) → camelCase (IntegrationContext) mapping happens
 * here so tool executors don't have to think about it.
 */

import { persistRefreshedAccessToken } from './oauth-token-store';

interface OAuthConnRow {
  phone_number: string;
  provider: string;
  service: string;
  access_token: string;
  refresh_token?: string | null;
  metadata?: Record<string, unknown>;
}

export function googleIntegrationCtx(conn: OAuthConnRow) {
  return {
    accessToken: conn.access_token,
    refreshToken: conn.refresh_token ?? undefined,
    metadata: conn.metadata,
    onTokenRefreshed: (newAccessToken: string, expiresAtIso: string) => {
      // Fire-and-forget — never block the API call on persistence.
      void persistRefreshedAccessToken({
        phoneNumber: conn.phone_number,
        provider: conn.provider,
        service: conn.service,
        newAccessToken,
        expiresAtIso,
      });
    },
  };
}
