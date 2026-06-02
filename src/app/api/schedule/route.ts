import { NextRequest, NextResponse } from 'next/server'
import { scheduledPostsDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET: upcoming scheduled posts
export async function GET() {
  const posts = await scheduledPostsDb.getUpcoming(50)
  return NextResponse.json({ posts })
}

// POST: create a scheduled post
export async function POST(req: NextRequest) {
  const { story_id, channel_id, platform, scheduled_at } = await req.json()

  if (!story_id || !platform || !scheduled_at) {
    return NextResponse.json({ error: 'story_id, platform, scheduled_at required' }, { status: 400 })
  }
  if (!['youtube', 'instagram', 'facebook'].includes(platform)) {
    return NextResponse.json({ error: 'platform must be youtube, instagram, or facebook' }, { status: 400 })
  }

  const scheduledDate = new Date(scheduled_at)
  if (isNaN(scheduledDate.getTime()) || scheduledDate < new Date()) {
    return NextResponse.json({ error: 'scheduled_at must be a future date' }, { status: 400 })
  }

  const post = await scheduledPostsDb.create({
    story_id, channel_id: channel_id || 'default', platform,
    scheduled_at: scheduledDate.toISOString(),
  })
  return NextResponse.json({ post })
}

// DELETE: cancel a scheduled post
export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  await scheduledPostsDb.delete(id)
  return NextResponse.json({ success: true })
}
