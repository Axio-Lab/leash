import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@leash/schemas',
    '@leash/core',
    '@leash/buyer-kit',
    '@leash/seller-kit',
    '@leash/registry-utils',
  ],
  output: 'standalone',
  serverExternalPackages: [
    '@metaplex-foundation/umi-bundle-defaults',
    '@metaplex-foundation/mpl-core',
  ],
};

export default nextConfig;
