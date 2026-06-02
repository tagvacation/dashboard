import { NextResponse } from 'next/server'
import { pipelineDb } from '@/lib/db'
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
  await pipelineDb.create(storyId)

  // Start pipeline in background — don't await
  runPipeline(storyId).catch(async (err) => {
    console.error(`Pipeline ${storyId} crashed:`, err)
    try {
      await pipelineDb.setStep(storyId, 'failed', { error: String(err) })
    } catch { /* ignore */ }
  })

  return NextResponse.json({ story_id: storyId, message: 'Pipeline started' })
}
