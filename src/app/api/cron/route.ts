/**
 * POST /api/cron — called by Railway Cron Job every minute
 * Protected by CRON_SECRET header to prevent unauthorized calls
 */
import { NextRequest, NextResponse } from 'next/server'
import { scheduledPostsDb, storiesDb } from '@/lib/db'
import { uploadToYouTube } from '@/lib/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret')
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
}

export async function POST(req: NextRequest) {
  // Validate cron secret
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pending = await scheduledPostsDb.getPending()
  console.log(`[Cron] Running — ${pending.length} post(s) due`)

  if (pending.length === 0) {
    return NextResponse.json({ processed: 0, message: 'Nothing due' })
  }

  const results: { id: number; story_id: string; status: string; url?: string; error?: string }[] = []

  for (const post of pending) {
    await scheduledPostsDb.update(post.id, { status: 'processing' })

    try {
      const story = await storiesDb.get(post.story_id)
      if (!story) throw new Error(`Story ${post.story_id} not found in DB`)

      if (post.platform === 'youtube') {
        const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/stories/${post.story_id}/final/reel.mp4`

        // Verify final reel exists in GCS
        const check = await fetch(gcsUrl, { method: 'HEAD' })
        if (!check.ok) throw new Error('Final reel not in GCS. Upload the edited video first.')

        const ytTitle = post.title || story.topic.slice(0, 100)
        const ytDesc  = post.description || `${story.topic}\n\n#shorts #hindistory #moralstory #kathakar`
        const ytTags  = post.tags ? post.tags.split(',').map(t => t.trim()).filter(Boolean) : ['shorts', 'hindi story', 'kathakar']

        console.log(`[Cron] Uploading story ${post.story_id} to YouTube...`)
        const result = await uploadToYouTube({ videoPath: gcsUrl, title: ytTitle, description: ytDesc, tags: ytTags, isShort: true })

        const youtubeUrl = `https://youtube.com/shorts/${result.id}`
        await storiesDb.update(post.story_id, { youtube_link: youtubeUrl, status: 'published' })
        await scheduledPostsDb.update(post.id, { status: 'posted', result_url: youtubeUrl })

        console.log(`[Cron] ✓ Published: ${youtubeUrl}`)
        results.push({ id: post.id, story_id: post.story_id, status: 'posted', url: youtubeUrl })
      } else {
        throw new Error(`${post.platform} auto-publish not yet supported`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[Cron] ✗ Failed post ${post.id}:`, msg)
      await scheduledPostsDb.update(post.id, { status: 'failed', error: msg })
      results.push({ id: post.id, story_id: post.story_id, status: 'failed', error: msg })
    }
  }

  return NextResponse.json({ processed: results.length, results, timestamp: new Date().toISOString() })
}

// GET: check upcoming posts (no auth needed for monitoring)
export async function GET() {
  const upcoming = await scheduledPostsDb.getUpcoming(10)
  return NextResponse.json({
    upcoming_count: upcoming.length,
    next: upcoming[0] || null,
    server_time: new Date().toISOString(),
  })
}
