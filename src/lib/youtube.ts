import { google } from 'googleapis'

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
  videoPath: string // GCS public URL
  title: string
  description: string
  tags: string[]
  isShort?: boolean
}) {
  // Download video from GCS first
  const res = await fetch(videoPath)
  const buffer = await res.arrayBuffer()
  const stream = require('stream')
  const readable = new stream.PassThrough()
  readable.end(Buffer.from(buffer))

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description,
        tags,
        categoryId: '22', // People & Blogs
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
  })

  return response.data
}
