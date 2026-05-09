/** @type {import('next').NextConfig} */
const nextConfig = {
  // imapflow uses Node-only modules (dns, net, tls); keep it out of the client bundle.
  serverExternalPackages: ['imapflow'],
  // Force-include imapflow in lambdas — see apps/web/next.config.js for the rationale.
  outputFileTracingIncludes: {
    '/api/**': [
      '../../node_modules/.pnpm/imapflow@*/node_modules/imapflow/**/*',
      '../../node_modules/.pnpm/mailparser@*/node_modules/mailparser/**/*',
      '../../node_modules/.pnpm/nodemailer@*/node_modules/nodemailer/**/*',
      '../../node_modules/.pnpm/socks@*/node_modules/socks/**/*',
      '../../node_modules/.pnpm/encoding-japanese@*/node_modules/encoding-japanese/**/*',
      '../../node_modules/.pnpm/iconv-lite@*/node_modules/iconv-lite/**/*',
      '../../node_modules/.pnpm/libbase64@*/node_modules/libbase64/**/*',
      '../../node_modules/.pnpm/libmime@*/node_modules/libmime/**/*',
      '../../node_modules/.pnpm/libqp@*/node_modules/libqp/**/*',
      '../../node_modules/.pnpm/punycode.js@*/node_modules/punycode.js/**/*',
      '../../node_modules/imapflow/**/*',
    ],
  },
};

export default nextConfig;
