/** @type {import('next').NextConfig} */
const nextConfig = {
  // imapflow uses Node-only modules (dns, net, tls); keep it out of the client bundle.
  serverExternalPackages: ['imapflow'],
};

export default nextConfig;
