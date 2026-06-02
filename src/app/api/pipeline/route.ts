import { NextResponse } from 'next/server'
import db from '@/lib/db'

export async function GET() {
  const runs = db.prepare(
    'SELECT story_id, status, topic, theme, completed_clips, filtered_clips, operation_ids, created_at, updated_at, error FROM pipeline_runs ORDER BY created_at DESC LIMIT 20'
  ).all() as Record<string, string>[]

  return NextResponse.json({
    runs: runs.map(r => ({
      story_id: r.story_id,
      status: r.status,
      topic: r.topic,
      theme: r.theme,
      completed_clips: JSON.parse(r.completed_clips || '[]').length,
      total_ops: Object.keys(JSON.parse(r.operation_ids || '{}')).length,
      filtered_clips: JSON.parse(r.filtered_clips || '[]').length,
      created_at: r.created_at,
      updated_at: r.updated_at,
      error: r.error,
    })),
  })
}
