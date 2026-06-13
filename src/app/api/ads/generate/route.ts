import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { sql, pipelineDb, storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/ads/generate
 * Body: { name, category, price?, benefits[], target_audience, tone, duration_sec, imageGcsUri? }
 * Returns: { story_id }
 *
 * Creates the pipeline_run record then triggers async runner.
 * Frontend redirects to dashboard to watch progress.
 */
export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { name, category, price, benefits, target_audience, tone, duration_sec, imageGcsUri, credentialId } = body
  if (!name || !category || !benefits?.length || !target_audience) {
    return NextResponse.json({ error: 'name, category, benefits, target_audience required' }, { status: 400 })
  }

  // Generate story_id
  const slug = String(name).toLowerCase().replace(/\s+/g, '_').slice(0, 25)
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '_')
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  const storyId = `ad_${today}_${slug}_${rand}`

  try {
    // Create story + pipeline_run records — runner picks it up
    await sql`
      INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, user_id)
      VALUES (${storyId}, ${`${name} — AI Ad`}, ${'ai_ad'}, ${'init'}, ${`stories/${storyId}/`}, ${'ai_ad_talking_product'}, ${userId})
    `
    await pipelineDb.create(storyId)

    // Store product details + image reference + cloud account in pipeline_runs.operation_ids JSON
    // (re-using existing column as flexible metadata bucket)
    const meta = {
      product: { name, category, price, benefits, target_audience, tone, duration_sec },
      imageGcsUri: imageGcsUri || null,
      credentialId: credentialId || null,
    }
    await sql`
      UPDATE pipeline_runs SET operation_ids = ${sql.json(meta)},
        topic = ${`${name} — AI Ad`}, theme = ${'ai_ad'},
        updated_at = NOW()
      WHERE story_id = ${storyId}
    `
    await sql`UPDATE pipeline_runs SET user_id = ${userId} WHERE story_id = ${storyId}`

    // Trigger background generation by calling pipeline runner.
    // Fire-and-forget — UI polls /api/pipeline/{id} for progress.
    triggerGeneration(storyId).catch(e => {
      console.error(`[ads] Generation trigger failed for ${storyId}:`, e)
    })

    return NextResponse.json({ story_id: storyId })
  } catch (e) {
    console.error('Ad generate error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

// Dynamically import runner so this route doesn't block on its bundle.
async function triggerGeneration(storyId: string) {
  const { runAdPipeline } = await import('@/lib/pipeline/ad-runner')
  await runAdPipeline(storyId)
}
