import { NextResponse } from 'next/server'
import db from '@/lib/db'
import { runPipeline } from '@/lib/pipeline/runner'

export const dynamic = 'force-dynamic'


function generateStoryId() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `story_${y}_${m}_${d}_${seq}`
}

export async function POST() {
  const storyId = generateStoryId()

  // Create pipeline run record
  db.prepare(`
    INSERT INTO pipeline_runs (story_id, status, created_at, updated_at)
    VALUES (?, 'init', ?, ?)
  `).run(storyId, new Date().toISOString(), new Date().toISOString())

  // Start pipeline in background — don't await
  runPipeline(storyId).catch(err => {
    console.error(`Pipeline ${storyId} crashed:`, err)
    try {
      db.prepare("UPDATE pipeline_runs SET status = 'failed', error = ?, updated_at = ? WHERE story_id = ?")
        .run(String(err), new Date().toISOString(), storyId)
    } catch { /* ignore */ }
  })

  return NextResponse.json({ story_id: storyId, message: 'Pipeline started' })
}
