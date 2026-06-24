import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { sql, pipelineDb, gcpCredentialsDb } from '@/lib/db'

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

  const { name, category, price, benefits, ingredients, target_audience, tone, voice, music, duration_sec, imageGcsUri, cutoutGcsUri, modelImages, credentialId } = body
  const storeId = body.store_id || ''
  const productUrl = body.product_url || ''
  const productHandle = body.product_handle || ''
  const variantId = body.variant_id || ''
  const adStyle = ['mascot', 'model', 'emotional', 'broll', 'auto'].includes(body.ad_style) ? body.ad_style : 'emotional'
  // Resolve background-music mood: explicit pick, 'none', or 'auto' → derive from tone.
  const TONE_MOOD: Record<string, string> = { bold: 'epic', funny: 'upbeat', emotional: 'warm', warm: 'warm', informative: 'calm' }
  const musicMood = !music || music === 'auto' ? (TONE_MOOD[tone as string] || 'upbeat') : music
  if (!name || !category || !benefits?.length || !target_audience) {
    return NextResponse.json({ error: 'name, category, benefits, target_audience required' }, { status: 400 })
  }

  // Directive: generation runs on the MAIN account. Only honor an explicit, owned credential;
  // otherwise default to main (credentialId '' → pipeline uses envContext()). We no longer
  // auto-pick the user's "default" account — the active ones here are misconfigured
  // (billing disabled / bucket "no-name") and were silently breaking generation.
  let cred = (credentialId && credentialId !== 'default') ? await gcpCredentialsDb.get(credentialId) : null
  if (cred && cred.user_id !== userId) cred = null // ownership check
  const resolvedCredId = cred?.id || ''

  // Generate story_id
  // URL-safe slug: collapse any non-alphanumeric run (spaces, %, etc.) to '_'.
  // A stray '%' here breaks /library/[id] routing (malformed percent-escape → 400).
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 25)
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '_')
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  const storyId = `ad_${today}_${slug}_${rand}`

  try {
    // Create story + pipeline_run records — runner picks it up
    await sql`
      INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, user_id, gcp_credential_id, store_id, product_url, product_handle, variant_id)
      VALUES (${storyId}, ${`${name} — AI Ad`}, ${'ai_ad'}, ${'init'}, ${`stories/${storyId}/`}, ${'ai_ad_talking_product'}, ${userId}, ${resolvedCredId}, ${storeId}, ${productUrl}, ${productHandle}, ${variantId})
    `
    await pipelineDb.create(storyId)

    // Store product details + image reference + cloud account in pipeline_runs.operation_ids JSON
    // (re-using existing column as flexible metadata bucket)
    const meta = {
      product: { name, category, price, benefits, ingredients: ingredients || null, target_audience, tone, duration_sec },
      imageGcsUri: imageGcsUri || null,
      cutoutGcsUri: cutoutGcsUri || null,
      modelImages: Array.isArray(modelImages) && modelImages.length ? modelImages : null,
      ad_style: adStyle,
      voice: voice && voice !== 'auto' ? voice : null,
      music: musicMood,
      credentialId: resolvedCredId,
    }
    await sql`
      UPDATE pipeline_runs SET operation_ids = ${sql.json(meta)},
        topic = ${`${name} — AI Ad`}, theme = ${'ai_ad'},
        updated_at = NOW()
      WHERE story_id = ${storyId}
    `
    await sql`UPDATE pipeline_runs SET user_id = ${userId} WHERE story_id = ${storyId}`

    // Queue for the worker (USE_WORKER=1) so heavy work runs off the web process; otherwise
    // run inline (local/dev). When body.preview is set (mascot only), make a cheap storyboard
    // DRAFT first (Imagen stills, no Veo) for the merchant to approve before we spend on Veo.
    const { runOrEnqueue } = await import('@/lib/pipeline/queue')
    const jobType = (body.preview === true && adStyle === 'mascot') ? 'draft' : 'ad'
    await runOrEnqueue(storyId, jobType)

    return NextResponse.json({ story_id: storyId, draft: jobType === 'draft' })
  } catch (e) {
    console.error('Ad generate error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
