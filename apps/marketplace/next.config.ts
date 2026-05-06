import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@leashmarket/platform-auth'],
  output: 'standalone',
  serverExternalPackages: ['@privy-io/server-auth', '@libsql/client', 'ioredis'],
  async redirects() {
    return [
      // Old /dev/* and /settings/api-keys URLs — keep inbound links alive while
      // the surface is rebranded around creators.
      { source: '/dev', destination: '/creator', permanent: false },
      { source: '/dev/dashboard', destination: '/creator', permanent: false },
      { source: '/dev/list', destination: '/creator/list', permanent: false },
      { source: '/dev/listings', destination: '/creator/tools', permanent: false },
      { source: '/dev/listings/:slug', destination: '/creator/tools/:slug', permanent: false },
      { source: '/settings/api-keys', destination: '/creator/api-keys', permanent: false },
      { source: '/admin/queue', destination: '/creator/admin/queue', permanent: false },
    ];
  },
};

export default nextConfig;
