import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@leash/schemas', '@leash/core'],
  output: 'standalone',
};

export default nextConfig;
