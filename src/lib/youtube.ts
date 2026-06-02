import { google } from 'googleapis'
import { Readable } from 'stream'

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
)

oauth2Client.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
})

export const youtube = google.youtube({ version: 'v3', auth: oauth2Client })

export async function uploadToYouTube({
  videoPath,
  title,
  description,
  tags,
  isShort = true,
}: {
  videoPath: string  // GCS public URL
  title: string
  description: string
  tags: string[]
  isShort?: boolean
}) {
  // Stream directly from GCS URL — no memory buffer (fixes ECONNRESET on large files)
  const res = await fetch(videoPath, { headers: { 'Accept': 'video/mp4' } })
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch video from GCS: ${res.status} ${res.statusText}`)
  }

  // Convert Web ReadableStream to Node.js Readable for googleapis
  const readable = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])

  const response = await youtube.videos.insert({
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
