/**
 * POST /api/cron — called by Railway cron or internal scheduler every minute
 * Processes pending scheduled posts whose scheduled_at <= NOW()
 */
import { NextResponse } from 'next/server'
import { scheduledPostsDb, storiesDb } from '@/lib/db'
import { uploadToYouTube } from '@/lib/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const pending = await scheduledPostsDb.getPending()
  if (pending.length === 0) return NextResponse.json({ processed: 0 })

  const results: { id: number; status: string; error?: string }[] = []

  for (const post of pending) {
    await scheduledPostsDb.update(post.id, { status: 'processing' })

    try {
      const story = await storiesDb.get(post.story_id)
      if (!story) throw new Error(`Story ${post.story_id} not found`)
      if (!story.youtube_link && post.platform === 'youtube') {
        // Need final video — check if it exists in GCS
        const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/stories/${post.story_id}/final/reel.mp4`
        const check = await fetch(gcsUrl, { method: 'HEAD' })
        if (!check.ok) throw new Error('Final reel not uploaded yet. Upload it first.')

        const result = await uploadToYouTube({
          videoPath: gcsUrl,
          title: story.topic.slice(0, 100),
          description: `${story.topic}\n\n#shorts #hindistory #moralstory #kathakar`,
          tags: ['shorts', 'hindi story', 'moral story', 'kathakar'],
          isShort: true,
        })
        const youtubeUrl = `https://youtube.com/shorts/${result.id}`
        await storiesDb.update(post.story_id, { youtube_link: youtubeUrl, status: 'published' })
        await scheduledPostsDb.update(post.id, { status: 'posted', result_url: youtubeUrl })
        results.push({ id: post.id, status: 'posted' })
      } else {
        // Platform not yet implemented (instagram, facebook)
        throw new Error(`${post.platform} publishing not yet automated — do it manually`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await scheduledPostsDb.update(post.id, { status: 'failed', error: msg })
      results.push({ id: post.id, status: 'failed', error: msg })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}

// GET: status check
export async function GET() {
  const upcoming = await scheduledPostsDb.getUpcoming(5)
  return NextResponse.json({ upcoming_count: upcoming.length, next: upcoming[0] || null })
}
