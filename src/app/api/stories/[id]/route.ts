import { NextRequest, NextResponse } from 'next/server'
import { deleteStory, listStoryFiles } from '@/lib/gcs'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

// ─── GET: fresh GCS data merged with DB row ────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const [files, row] = await Promise.all([
      listStoryFiles(id),
      storiesDb.get(id),
    ])

    const clips = files
      .filter(f => f.name.includes('/clips/') && f.name.endsWith('.mp4'))
      .map(f => ({ name: f.name, url: `${PUBLIC_BASE}/${f.name}`, size: f.size }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const audioFile = files.find(f => f.name.includes('/audio/') && f.name.endsWith('.mp3'))

    return NextResponse.json({
      story: {
        ...(row || {}),
        story_id: id,
        clips,
        hasAudio: !!audioFile || !!row?.audio_url,
        audio_url: audioFile ? `${PUBLIC_BASE}/${audioFile.name}` : (row?.audio_url || ''),
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
