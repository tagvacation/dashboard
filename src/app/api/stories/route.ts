import { NextRequest, NextResponse } from 'next/server'
import { storiesDb } from '@/lib/db'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stories — fast Library list (ONE indexed query, trimmed columns).
 *
 * Returns only what the grid renders (no SELECT *, no GCS, no per-clip queries).
 * Optional filters: ?store=<id> (filter by store), ?channelId=<id>.
 */
export async function GET(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const storeId = req.nextUrl.searchParams.get('store') || undefined
  const channelId = req.nextUrl.searchParams.get('channelId') || undefined

  try {
    const rows = await storiesDb.listLite(userId, { storeId, channelId })
    const stories = rows.map(r => ({
      story_id: r.story_id,
      topic: r.topic,
      status: r.status,
      theme: r.theme,
      category_id: r.category_id,
      created_at: r.created_at,
      youtube_link: r.youtube_link,
      scenes_count: r.scenes_count,
      store_id: r.store_id,
      final_url: r.final_url,
      hasAudio: r.has_audio,
    }))
    return NextResponse.json({ stories })
  } catch (e: unknown) {
    console.error('Stories fetch error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
