import { NextRequest, NextResponse } from 'next/server'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// PUT: set youtube_link manually
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { url } = await req.json()

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  // Basic YouTube URL validation
  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')
  if (!isYouTube) {
    return NextResponse.json({ error: 'Must be a YouTube URL (youtube.com or youtu.be)' }, { status: 400 })
  }

  try {
    await storiesDb.update(id, { youtube_link: url.trim(), status: 'published' })
    return NextResponse.json({ success: true, youtube_link: url.trim() })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

// DELETE: remove youtube_link
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await storiesDb.update(id, { youtube_link: '', status: 'clips_ready' })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
