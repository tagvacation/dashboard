import { NextRequest, NextResponse } from 'next/server'
import { uploadToYouTube } from '@/lib/youtube'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 600 // 10 min for YouTube upload

// POST body: { title, description, tags }
// Video is read from GCS (stories/{id}/final/reel.mp4) — no large body from client
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params

  let title = storyId, description = '', tags: string[] = ['shorts', 'hindi story', 'kathakar']
  let channelId: string | undefined

  try {
    const body = await req.json()
    title = body.title || title
    description = body.description || description
    tags = Array.isArray(body.tags) ? body.tags : tags
    channelId = body.channelId
  } catch { /* use defaults */ }

  // If channelId not in body, fall back to story's channel_id
  if (!channelId) {
    const story = await storiesDb.get(storyId)
    channelId = story?.channel_id
  }

  // Build the GCS public URL for the uploaded reel
  const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/stories/${storyId}/final/reel.mp4`

  // Verify the file exists in GCS before attempting YouTube upload
  const headRes = await fetch(gcsUrl, { method: 'HEAD' }).catch(() => null)
  if (!headRes || !headRes.ok) {
    return NextResponse.json({
      error: 'Video not found in GCS. Upload the final reel first using the step above.',
    }, { status: 400 })
  }

  try {
    // Stream from GCS → YouTube (no client body involved, no size limit)
    const result = await uploadToYouTube({ videoPath: gcsUrl, title, description, tags, isShort: true, channelId })

    const videoId = result.id
    if (!videoId) throw new Error('YouTube returned no video ID')
    const youtubeUrl = `https://youtube.com/shorts/${videoId}`

    await storiesDb.update(storyId, { youtube_link: youtubeUrl, status: 'published' })

    return NextResponse.json({ success: true, youtubeUrl, videoId })

  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: { message?: string; code?: number } } }; message?: string }
    const apiMsg = err?.response?.data?.error?.message
    const code = err?.response?.data?.error?.code
    const message = apiMsg || err?.message || 'Upload failed'
    console.error('YouTube upload error:', message)

    if (code === 401 || message.includes('invalid_grant') || message.includes('Token')) {
      return NextResponse.json({ error: 'YouTube token expired. Reconnect YouTube in settings.' }, { status: 401 })
    }
    if (message.includes('quota')) {
      return NextResponse.json({ error: 'YouTube quota exceeded. Try again tomorrow.' }, { status: 429 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
