import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { youtube } from '@/lib/youtube'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 600 // 10 min

function isAuthorized(req: NextRequest): boolean {
  const token = req.cookies.get('auth_token')?.value
  const expected = Buffer.from(`${process.env.DASHBOARD_PASSWORD}:${process.env.JWT_SECRET}`).toString('base64')
  return token === expected
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: storyId } = await params
  if (!req.body) return NextResponse.json({ error: 'No video body' }, { status: 400 })

  const title = decodeURIComponent(req.headers.get('x-title') || storyId.replace(/_/g, ' '))
  const description = decodeURIComponent(req.headers.get('x-description') || '')
  const tagsRaw = decodeURIComponent(req.headers.get('x-tags') || 'shorts,hindi story,kathakar')
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)

  try {
    const readable = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0])

    const result = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title: title.slice(0, 100), description, tags, categoryId: '22', defaultLanguage: 'hi', defaultAudioLanguage: 'hi' },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      },
      media: { mimeType: 'video/mp4', body: readable },
    }, { timeout: 600_000 })

    const videoId = result.data.id
    if (!videoId) throw new Error('YouTube returned no video ID')
    const youtubeUrl = `https://youtube.com/shorts/${videoId}`

    // Store in PostgreSQL
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
