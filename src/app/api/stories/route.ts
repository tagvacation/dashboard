import { NextRequest, NextResponse } from 'next/server'
import { storiesDb, sql } from '@/lib/db'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

/**
 * GET /api/stories — fast list endpoint.
 *
 * Old implementation called bucket.getFiles({prefix:'stories/'}) which lists EVERY
 * file across EVERY story across EVERY user. Catastrophic O(n) on every page load.
 *
 * New implementation: derive clip URLs from scene_jobs (DB only, no GCS calls).
 * Paths are deterministic — we KNOW where the clip is if scene_jobs.status='done'.
 */
export async function GET(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const channelId = req.nextUrl.searchParams.get('channelId') || undefined

  try {
    const stories = await storiesDb.getAll(channelId, userId)
    if (stories.length === 0) return NextResponse.json({ stories: [] })

    // Single batch query: get done scene_jobs for all visible stories
    const storyIds = stories.map(s => s.story_id)
    const sceneRows = await sql<{ story_id: string; scene_num: string }[]>`
      SELECT story_id, scene_num FROM scene_jobs
      WHERE story_id = ANY(${storyIds}) AND status = 'done'
      ORDER BY story_id, scene_num
    `

    // Group by story_id (only most recent attempt's done scenes count)
    const clipsByStory: Record<string, { name: string; url: string; size: number }[]> = {}
    for (const row of sceneRows) {
      const sn = String(row.scene_num).padStart(2, '0')
      const path = `stories/${row.story_id}/clips/scene_${sn}.mp4`
      ;(clipsByStory[row.story_id] = clipsByStory[row.story_id] || []).push({
        name: path,
        url: `${PUBLIC_BASE}/${path}`,
        size: 0, // size not needed in list view — fetch on detail if needed
      })
    }

    const enriched = stories.map(story => {
      const clips = clipsByStory[story.story_id] || []
      return {
        ...story,
        clips,
        hasAudio: !!story.audio_url,
        scenes_count: clips.length > 0 ? clips.length : story.scenes_count,
      }
    })

    return NextResponse.json({ stories: enriched })
  } catch (e: unknown) {
    console.error('Stories fetch error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
