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
    '@anthropic-ai/claude-agent-sdk',
    '@metaplex-foundation/umi-bundle-defaults',
    '@metaplex-foundation/mpl-core',
    '@privy-io/server-auth',
    '@libsql/client',
  ],
};

export default nextConfig;
