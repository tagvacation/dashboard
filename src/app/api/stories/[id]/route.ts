import { NextRequest, NextResponse } from 'next/server'
import { deleteStory, listStoryFiles } from '@/lib/gcs'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ─── GET: fresh GCS data merged with DB row ────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const row = await storiesDb.get(id)
    // listStoryFiles returns per-story bucket URLs (f.url); empty if no Cloud account yet.
    const files = await listStoryFiles(id).catch(() => [] as Awaited<ReturnType<typeof listStoryFiles>>)

    const clips = files
      .filter(f => f.name.includes('/clips/') && f.name.endsWith('.mp4'))
      .map(f => ({ name: f.name, url: f.url, size: f.size }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const audioFile = files.find(f => f.name.includes('/audio/') && f.name.endsWith('.mp3'))

    return NextResponse.json({
      story: {
        ...(row || {}),
        story_id: id,
        clips,
        hasAudio: !!audioFile || !!row?.audio_url,
        audio_url: audioFile ? audioFile.url : (row?.audio_url || ''),
        scenes_count: clips.length > 0 ? clips.length : (row?.scenes_count || 0),
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

// ─── DELETE: GCS files + DB row ───────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
