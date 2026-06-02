import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const dynamic = 'force-dynamic'


export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = db.prepare('SELECT * FROM pipeline_runs WHERE story_id = ?').get(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const r = run as Record<string, string>
  return NextResponse.json({
    story_id: r.story_id,
    status: r.status,
    topic: r.topic,
    theme: r.theme,
    log: JSON.parse(r.log || '[]'),
    operation_ids: JSON.parse(r.operation_ids || '{}'),
    completed_clips: JSON.parse(r.completed_clips || '[]'),
    filtered_clips: JSON.parse(r.filtered_clips || '[]'),
    error: r.error,
    created_at: r.created_at,
    updated_at: r.updated_at,
  })
}

// GET all recent pipeline runs
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  db.prepare('DELETE FROM pipeline_runs WHERE story_id = ?').run(id)
  return NextResponse.json({ ok: true })
}
