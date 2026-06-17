import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { storesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stores/{id}/feed — the shoppable JSON the user copies into the extension.
 * Flat array; the extension groups by product_url to build a per-product slider.
 * video_url points at the small web/slider version (reel_preview.mp4), not the master.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params

  const store = await storesDb.get(id)
  if (!store || store.user_id !== userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await storesDb.feedRows(id, userId)
  const feed = rows.map(r => ({
    product_url: r.product_url,
    handle: r.product_handle || undefined,
    variant_id: r.variant_id || undefined,
    title: r.topic?.replace(/ — (AI Ad|Mascot Ad|Live Model)$/, '') || '',
    video_url: r.final_url.replace('/reel.mp4', '/reel_preview.mp4'), // small web version
    master_url: r.final_url,
  }))
  return NextResponse.json(feed)
}
