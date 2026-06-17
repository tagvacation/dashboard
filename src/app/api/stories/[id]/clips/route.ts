import { NextRequest, NextResponse } from 'next/server'
import { listStoryFiles } from '@/lib/gcs'
import { requireUserId } from '@/lib/auth-server'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stories/[id]/clips — the per-scene clip URLs + narration audio.
 *
 * Loaded ON DEMAND (when the user opens the "Individual clips" section in the detail
 * page), so the main detail load never pays for a GCS bucket listing.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params

  const row = await storiesDb.get(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id && row.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const files = await listStoryFiles(id).catch(() => [] as Awaited<ReturnType<typeof listStoryFiles>>)
    const clips = files
      .filter(f => f.name.includes('/clips/') && f.name.endsWith('.mp4'))
      .map(f => ({ name: f.name, url: f.url, size: f.size }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const audioFile = files.find(f => f.name.includes('/audio/') && f.name.endsWith('.mp3'))
    return NextResponse.json({ clips, audio_url: audioFile?.url || row.audio_url || '' })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
