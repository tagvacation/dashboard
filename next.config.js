/** @type {import('next').NextConfig} */
const nextConfig = {
  // Increase body size for video uploads through middleware → route handler
  middlewareClientMaxBodySize: 500 * 1024 * 1024, // 500MB in bytes
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
  serverExternalPackages: ['fluent-ffmpeg', '@google-cloud/storage', 'postgres'],
}

module.exports = nextConfig
