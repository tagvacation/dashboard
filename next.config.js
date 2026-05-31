/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/ai_clip_007/**',
      },
    ],
  },
  // Allow ffmpeg binary access
  serverExternalPackages: ['fluent-ffmpeg', '@google-cloud/storage'],
}

module.exports = nextConfig
