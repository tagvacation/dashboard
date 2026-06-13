import { google } from 'googleapis'
import { Readable } from 'stream'
import { channelsDb } from './db'

// Default YouTube client from env vars (legacy single-channel mode)
const defaultOauth = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
)
defaultOauth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN })

export const youtube = google.youtube({ version: 'v3', auth: defaultOauth })

/**
 * Get an OAuth2 client for a specific channel. Falls back to env vars if no channelId.
 */
export async function getYouTubeClientForChannel(channelId?: string) {
  if (!channelId || channelId === 'default') return defaultOauth

  const channel = await channelsDb.getById(channelId)
  if (!channel?.yt_refresh_token || !channel?.yt_client_id || !channel?.yt_client_secret) {
    console.warn(`Channel ${channelId} missing YT credentials, using env default`)
    return defaultOauth
  }

  const oauth = new google.auth.OAuth2(
    channel.yt_client_id,
    channel.yt_client_secret,
    channel.yt_redirect_uri || process.env.YOUTUBE_REDIRECT_URI,
  )
  oauth.setCredentials({ refresh_token: channel.yt_refresh_token })
  return oauth
}

export async function uploadToYouTube({
  videoPath,
  title,
  description,
  tags,
  isShort = true,
  channelId,
}: {
  videoPath: string  // GCS public URL
  title: string
  description: string
  tags: string[]
  isShort?: boolean
  channelId?: string  // optional — falls back to env vars
}) {
  const oauth = await getYouTubeClientForChannel(channelId)
  const yt = google.youtube({ version: 'v3', auth: oauth })
  // Stream directly from GCS URL — no memory buffer (fixes ECONNRESET on large files)
  const res = await fetch(videoPath, { headers: { 'Accept': 'video/mp4' } })
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch video from GCS: ${res.status} ${res.statusText}`)
  }

  // Convert Web ReadableStream to Node.js Readable for googleapis
  const readable = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])

  const response = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description,
        tags,
        categoryId: '22',   // People & Blogs
        defaultLanguage: 'hi',
        defaultAudioLanguage: 'hi',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: readable,
    },
  }, {
    // Increase timeout for large video uploads (10 minutes)
    timeout: 600_000,
  })

  return response.data
}
