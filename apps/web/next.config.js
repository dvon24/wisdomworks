/** @type {import('next').NextConfig} */
const nextConfig = {
  // imapflow uses Node-only modules (dns, net, tls); keep it out of the client bundle.
  // Each API route that needs IMAP also includes a side-effect `import 'imapflow'`
  // so Vercel's NFT can see the dep and ship it into the lambda.
  serverExternalPackages: ['imapflow'],
};

export default nextConfig;
