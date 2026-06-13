/**
 * Regenerate a mascot ad through the REAL in-app pipeline (dynamic DB prompts —
 * no hardcoding). Copies product + image from an existing ad story so it reuses
 * what you already uploaded, then runs the mascot pipeline end-to-end.
 *
 * Usage: npx tsx scripts/run-mascot-ad.mts [sourceStoryId]
 * Default source: the C-Cinamide sunscreen ad.
 */
import { readFileSync } from 'fs'
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^["']|["']$/g, '')
}
const { sql, pipelineDb } = await import('../src/lib/db.ts')
const { runMascotAdPipeline } = await import('../src/lib/pipeline/mascot-runner.ts')

const SOURCE = process.argv[2] || 'ad_2026_06_13_c_cinamide_radiance_sunsc_992'

const [src] = await sql`SELECT operation_ids, user_id, category_id FROM pipeline_runs pr JOIN stories s USING (story_id) WHERE story_id = ${SOURCE}`
  .catch(async () => {
    // pipeline_runs has no user_id join guarantee; fall back to separate reads
    const [pr] = await sql`SELECT operation_ids FROM pipeline_runs WHERE story_id = ${SOURCE}`
    const [st] = await sql`SELECT user_id, category_id FROM stories WHERE story_id = ${SOURCE}`
    return [{ operation_ids: pr?.operation_ids, user_id: st?.user_id, category_id: st?.category_id }]
  })
if (!src?.operation_ids?.product) { console.error('Source story/meta not found:', SOURCE); process.exit(1) }

const meta = { ...src.operation_ids, ad_style: 'mascot' }
// Enrich with real product-page data + longer/dramatic (6 scenes ≈ 48s).
meta.product = {
  ...meta.product,
  duration_sec: 48,
  price: 687,
  benefits: [
    'SPF 50 PA++++ broad-spectrum UVA/UVB sun protection',
    'Brightens skin and fades dark spots (Vitamin C + Niacinamide)',
    'Lightweight aqua gel, no white cast, oil-free for acne-prone skin',
  ],
}
const today = new Date().toISOString().split('T')[0].replace(/-/g, '_')
const slug = String(meta.product.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 25)
const storyId = `ad_${today}_${slug}_mascot_${Math.floor(Math.random() * 1000)}`

console.log('New story:', storyId)
console.log('Product:', meta.product.name, '| image grounded:', !!meta.imageGcsUri, '| cutout:', !!meta.cutoutGcsUri)

await sql`
  INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, user_id)
  VALUES (${storyId}, ${`${meta.product.name} — Mascot Ad`}, 'ai_ad', 'init', ${`stories/${storyId}/`}, 'ai_ad_mascot_drama', ${src.user_id})
`
await pipelineDb.create(storyId)
await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(meta)}, user_id = ${src.user_id} WHERE story_id = ${storyId}`

await runMascotAdPipeline(storyId)

const [done] = await sql`SELECT final_url, status FROM stories WHERE story_id = ${storyId}`
console.log('\n✓ status:', done.status, '\n✓ final_url:', done.final_url || '(none)')
await sql.end()
process.exit(0)
