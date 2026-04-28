import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@leash/platform-auth'],
  output: 'standalone',
  serverExternalPackages: ['@privy-io/server-auth', '@libsql/client', 'ioredis'],
};

export default nextConfig;
