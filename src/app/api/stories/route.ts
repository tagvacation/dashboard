import { NextRequest, NextResponse } from 'next/server'
import { storiesDb, sql } from '@/lib/db'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

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

    // Resolve each story's bucket (per-user) via its credential — one batch query.
    const credIds = [...new Set(stories.map(s => (s as { gcp_credential_id?: string }).gcp_credential_id).filter(Boolean))] as string[]
    const credRows = credIds.length
      ? await sql<{ id: string; bucket: string }[]>`SELECT id, bucket FROM gcp_credentials WHERE id = ANY(${credIds})`
      : []
    const bucketByCred: Record<string, string> = Object.fromEntries(credRows.map(r => [r.id, r.bucket]))
    const bucketForStory = (s: { gcp_credential_id?: string }) => bucketByCred[s.gcp_credential_id || ''] || ''
    const storyById = Object.fromEntries(stories.map(s => [s.story_id, s]))

    // Group by story_id (only most recent attempt's done scenes count)
    const clipsByStory: Record<string, { name: string; url: string; size: number }[]> = {}
    for (const row of sceneRows) {
      const sn = String(row.scene_num).padStart(2, '0')
      const path = `stories/${row.story_id}/clips/scene_${sn}.mp4`
      const bkt = bucketForStory(storyById[row.story_id] as { gcp_credential_id?: string })
      ;(clipsByStory[row.story_id] = clipsByStory[row.story_id] || []).push({
        name: path,
        url: bkt ? `https://storage.googleapis.com/${bkt}/${path}` : '',
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
