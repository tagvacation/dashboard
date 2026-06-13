/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
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
  serverExternalPackages: ['fluent-ffmpeg', '@google-cloud/storage', 'postgres', '@imgly/background-removal-node', '@napi-rs/canvas'],
}

module.exports = nextConfig
