import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: ['firebase-admin'],
};

export default nextConfig;
