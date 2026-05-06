import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@leashmarket/schemas',
    '@leashmarket/core',
    '@leashmarket/buyer-kit',
    '@leashmarket/seller-kit',
    '@leashmarket/registry-utils',
  ],
  output: 'standalone',
  serverExternalPackages: [
    '@metaplex-foundation/umi-bundle-defaults',
    '@metaplex-foundation/mpl-core',
  ],
};

export default nextConfig;
