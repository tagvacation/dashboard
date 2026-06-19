import { NextRequest, NextResponse } from 'next/server'
import { pipelineDb } from '@/lib/db'
import { runOrEnqueue } from '@/lib/pipeline/queue'

export const dynamic = 'force-dynamic'

function generateStoryId() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `story_${y}_${m}_${d}_${seq}`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const categoryId = body.category_id || undefined
  const credentialId = body.credential_id || undefined  // which GCP account to use

  const storyId = generateStoryId()
  await pipelineDb.create(storyId)

  // Queue for the worker (USE_WORKER=1) or run inline (local/dev).
  runOrEnqueue(storyId, 'story', { categoryId, credentialId }).catch(async (err) => {
    console.error(`Pipeline ${storyId} crashed:`, err)
    try { await pipelineDb.setStep(storyId, 'failed', { error: String(err) }) } catch { /* ignore */ }
  })

  return NextResponse.json({
    story_id: storyId,
    category_id: categoryId || 'default',
    credential_id: credentialId || 'default',
    message: 'Pipeline started',
  })
}
