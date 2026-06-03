/**
 * POST /api/cron/run — manual trigger from dashboard UI
 * Uses dashboard auth cookie (not CRON_SECRET)
 * Calls the same processing logic as the Railway cron
 */
import { NextRequest, NextResponse } from 'next/server'
import { scheduledPostsDb, storiesDb } from '@/lib/db'
import { uploadToYouTube } from '@/lib/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const token = req.cookies.get('auth_token')?.value
  const expected = Buffer.from(`${process.env.DASHBOARD_PASSWORD}:${process.env.JWT_SECRET}`).toString('base64')
  return token === expected
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pending = await scheduledPostsDb.getPending()

  if (pending.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      message: 'No posts are due right now. Check that the scheduled time has passed.',
    })
  }

  const results: { id: number; story_id: string; platform: string; status: string; url?: string; error?: string }[] = []

  for (const post of pending) {
    await scheduledPostsDb.update(post.id, { status: 'processing' })

    try {
      const story = await storiesDb.get(post.story_id)
      if (!story) throw new Error(`Story not found: ${post.story_id}`)

      if (post.platform === 'youtube') {
        const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/stories/${post.story_id}/final/reel.mp4`
        const check = await fetch(gcsUrl, { method: 'HEAD' })
        if (!check.ok) throw new Error('Final reel not in GCS. Upload the edited video first from the story page.')

        const ytTitle = post.title || story.topic.slice(0, 100)
        const ytDesc  = post.description || `${story.topic}\n\n#shorts #hindistory #moralstory #kathakar`
        const ytTags  = post.tags ? post.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : ['shorts', 'hindi story', 'kathakar']

        const result = await uploadToYouTube({ videoPath: gcsUrl, title: ytTitle, description: ytDesc, tags: ytTags, isShort: true })
        const youtubeUrl = `https://youtube.com/shorts/${result.id}`

        await storiesDb.update(post.story_id, { youtube_link: youtubeUrl, status: 'published' })
        await scheduledPostsDb.update(post.id, { status: 'posted', result_url: youtubeUrl })

        results.push({ id: post.id, story_id: post.story_id, platform: 'youtube', status: 'posted', url: youtubeUrl })
      } else {
        throw new Error(`${post.platform} auto-publish not yet supported`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await scheduledPostsDb.update(post.id, { status: 'failed', error: msg })
      results.push({ id: post.id, story_id: post.story_id, platform: post.platform, status: 'failed', error: msg })
    }
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    results,
  })
}
