/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    instrumentationHook: true,  // enables src/instrumentation.ts for cron startup
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/ai_clip_007/**',
      },
    ],
  },
  serverExternalPackages: ['fluent-ffmpeg', '@google-cloud/storage', 'postgres'],
}

module.exports = nextConfig
