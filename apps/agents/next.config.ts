import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@leash/schemas',
    '@leash/core',
    '@leash/buyer-kit',
    '@leash/registry-utils',
    '@leash/platform-auth',
  ],
  output: 'standalone',
  serverExternalPackages: [
    '@metaplex-foundation/umi-bundle-defaults',
    '@metaplex-foundation/mpl-core',
    '@privy-io/server-auth',
    '@libsql/client',
    'ioredis',
  ],
};

export default nextConfig;
