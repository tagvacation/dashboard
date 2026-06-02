import { NextRequest, NextResponse } from 'next/server'
import { scheduledPostsDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const posts = await scheduledPostsDb.getUpcoming(50)
  return NextResponse.json({ posts })
}

export async function POST(req: NextRequest) {
  const { story_id, channel_id, platform, scheduled_at, title, description, tags } = await req.json()

  if (!story_id || !platform || !scheduled_at) {
    return NextResponse.json({ error: 'story_id, platform, scheduled_at required' }, { status: 400 })
  }
  if (!['youtube', 'instagram', 'facebook'].includes(platform)) {
    return NextResponse.json({ error: 'platform must be youtube, instagram, or facebook' }, { status: 400 })
  }

  const scheduledDate = new Date(scheduled_at)
  if (isNaN(scheduledDate.getTime()) || scheduledDate < new Date()) {
    return NextResponse.json({ error: 'scheduled_at must be a future date/time' }, { status: 400 })
  }

  const post = await scheduledPostsDb.create({
    story_id,
    channel_id: channel_id || 'default',
    platform,
    scheduled_at: scheduledDate.toISOString(),
    title: (title || '').slice(0, 100),
    description: description || '',
    tags: tags || 'shorts,hindi story,kathakar',
  })
  return NextResponse.json({ post })
}

// PATCH: update title/description/tags for an existing scheduled post
export async function PATCH(req: NextRequest) {
  const { id, title, description, tags } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await scheduledPostsDb.update_meta(id, (title || '').slice(0, 100), description || '', tags || '')
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  await scheduledPostsDb.delete(id)
  return NextResponse.json({ success: true })
}
