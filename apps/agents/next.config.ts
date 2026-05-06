import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@leashmarket/schemas',
    '@leashmarket/core',
    '@leashmarket/buyer-kit',
    '@leashmarket/registry-utils',
    '@leashmarket/platform-auth',
  ],
  output: 'standalone',
  serverExternalPackages: [
    '@anthropic-ai/claude-agent-sdk',
    '@metaplex-foundation/umi-bundle-defaults',
    '@metaplex-foundation/mpl-core',
    '@privy-io/server-auth',
    '@libsql/client',
  ],
};

export default nextConfig;
