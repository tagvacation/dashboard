import { NextRequest, NextResponse } from 'next/server'
import { deleteStory } from '@/lib/gcs'
import { storiesDb, sql } from '@/lib/db'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

// ─── GET: the DB row only (fast — no GCS) ──────────────────────────────────────
// Per-clip URLs are fetched on demand from /api/stories/[id]/clips so this stays cheap,
// even when polled every few seconds during generation.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const row = await storiesDb.get(id)
    return NextResponse.json({
      story: {
        ...(row || {}),
        story_id: id,
        hasAudio: !!row?.audio_url,
        audio_url: row?.audio_url || '',
        scenes_count: row?.scenes_count || 0,
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

// ─── PATCH: edit shoppable settings on an existing video (product link + store) ──
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params

  const row = await storiesDb.get(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((row as { user_id?: string }).user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const storeId = body.store_id !== undefined ? String(body.store_id) : undefined
  let productUrl = body.product_url !== undefined ? String(body.product_url).trim() : undefined
  let handle = ''; let variantId = ''

  // Enrich a Shopify product URL with handle + variant (needed for add-to-cart).
  if (productUrl) {
    productUrl = productUrl.split('?')[0].replace(/\/$/, '')
    try {
      const r = await fetch(`${productUrl}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (r.ok) {
        const p = (await r.json()).product
        if (p) { handle = p.handle || ''; variantId = p.variants?.[0]?.id ? String(p.variants[0].id) : '' }
      }
    } catch { /* non-shopify — leave handle/variant empty */ }
  }

  if (storeId !== undefined) await sql`UPDATE stories SET store_id = ${storeId} WHERE story_id = ${id}`
  if (productUrl !== undefined) await sql`UPDATE stories SET product_url = ${productUrl}, product_handle = ${handle}, variant_id = ${variantId} WHERE story_id = ${id}`

  return NextResponse.json({ success: true, handle, variant_id: variantId })
}

// ─── DELETE: GCS files + DB row (owner only) ──────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params

  const row = await storiesDb.get(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id && row.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await Promise.all([
      deleteStory(id).catch(e => console.warn('GCS delete warning:', e.message)),
      storiesDb.delete(id),
    ])
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Delete failed' }, { status: 500 })
  }
}
