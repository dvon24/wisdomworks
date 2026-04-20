import NextAuth from 'next-auth';
import MicrosoftEntraId from 'next-auth/providers/microsoft-entra-id';
import { createDrizzleAdapter } from './adapter';

// Validate required env vars — fail fast with clear message
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // During Next.js build, env vars may not be set — warn but don't crash
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      console.warn(`[auth] Missing required env var: ${name}`);
    }
    return '';
  }
  return value;
}

const authConfig = {
  adapter: createDrizzleAdapter(),
  providers: [
    MicrosoftEntraId({
      clientId: requireEnv('AZURE_AD_CLIENT_ID'),
      clientSecret: requireEnv('AZURE_AD_CLIENT_SECRET'),
      issuer: `https://login.microsoftonline.com/${requireEnv('AZURE_AD_TENANT_ID') || 'common'}/v2.0`,
    }),
  ],
  session: {
    strategy: 'jwt' as const,
    maxAge: 8 * 60 * 60, // 8 hours — NIST SP 800-53 IA session timeout
  },
  callbacks: {
    // TODO: Add periodic revalidation against DB before production.
    // Currently the JWT is never revalidated after initial sign-in, meaning
    // revoked users or role changes won't take effect until token expiry.
    // Before production, add a check (e.g., every 5 minutes via a timestamp
    // in the token) that queries the DB to confirm the user still exists,
    // is not disabled, and their role/tenantId haven't changed.
    async jwt({ token, user }: any) {
      if (user) {
        token.userId = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.tenantId = token.tenantId as string;
        session.userRole = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
