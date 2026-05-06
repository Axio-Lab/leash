import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The explorer is a peer of the API process — it imports `@leashmarket/api`
  // directly to read events / receipts / agent snapshots out of the
  // shared infra DB and Solana RPC, without an HTTP hop. Those packages
  // ship as ESM with NodeNext-style `.js` import suffixes, so Next has
  // to transpile them through its bundler.
  transpilePackages: [
    '@leashmarket/api',
    '@leashmarket/core',
    '@leashmarket/registry-utils',
    '@leashmarket/schemas',
  ],
  output: 'standalone',
};

export default nextConfig;
