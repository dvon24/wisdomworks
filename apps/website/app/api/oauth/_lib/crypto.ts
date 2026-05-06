/**
 * Token encryption — AES-256-GCM envelope encryption for OAuth tokens.
 *
 * Re-exports from packages/shared so apps/website and apps/web share one implementation.
 */

export { encryptToken, decryptToken } from '@wisdomworks/shared';
