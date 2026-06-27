/**
 * End-to-end live-model ANCHORING test: upload the labeled views → run the real pipeline
 * (compose per-scene stills + view-locked Veo) → print the final reel.
 *
 *   npx tsx scripts/test-model-render.mts [folder] [--account <id>]
 * folder default: ~/Desktop/live_model (face/front/back/side/closeup.*)
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).replace(/^["']|["']$/g, '') }

const args = process.argv.slice(2)
const ai = args.indexOf('--account')
const account = ai >= 0 ? args[ai + 1] : ''
const folder = args.find(a => !a.startsWith('--') && a !== account) || join(homedir(), 'Desktop', 'live_model')

const { sql, pipelineDb } = await import('../src/lib/db.ts')
const auth = await import('../src/lib/pipeline/auth.ts')
const { runModelVideoPipeline } = await import('../src/lib/pipeline/model-runner.ts')
const { Storage } = await import('@google-cloud/storage')

const ctx = await auth.loadGcpContext(account)
const mimeOf = (f: string) => f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
const find = (stem: string) => { const m = readdirSync(folder).find(f => f.toLowerCase().replace(/\.(jpg|jpeg|png|webp)$/, '') === stem); return m ? join(folder, m) : null }

const id = `test_model_${Date.now()}`
const bucket = new Storage({ credentials: ctx.storageCredentials }).bucket(ctx.bucket)
const modelViews: Record<string, string> = {}
for (const view of ['face', 'front', 'back', 'side', 'closeup']) {
  const p = find(view); if (!p) { console.error(`(no ${view})`); continue }
  const ext = p.split('.').pop()
  const path = `stories/${id}/inputs/${view}.${ext}`
  await bucket.file(path).save(readFileSync(p), { contentType: mimeOf(p.toLowerCase()), resumable: false })
  modelViews[view] = `gs://${ctx.bucket}/${path}`
  console.error(`uploaded ${view}`)
}

const [u] = await sql<{ user_id: string }[]>`SELECT user_id FROM stories WHERE user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`
const meta = {
  product: { name: 'Striped Cotton Shirt', category: 'Apparel', benefits: ['breathable cotton', 'classic blue stripes', 'effortless everyday style'], target_audience: 'women 22-35', tone: 'warm', duration_sec: 24 },
  imageGcsUri: modelViews.front || null,
  modelViews,
  music: null,
  credentialId: account || '',
}
await sql`INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, user_id, gcp_credential_id) VALUES (${id}, ${'Striped Cotton Shirt — Live Model'}, 'ai_ad', 'init', ${'stories/' + id + '/'}, 'ai_ad_model_video', ${u?.user_id || null}, ${account || ''})`
await pipelineDb.create(id)
await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(meta)))} WHERE story_id = ${id}`

console.error(`\n▶ Running model pipeline for ${id} (compute ${ctx.projectId})…\n`)
await runModelVideoPipeline(id)
const [s] = await sql<{ final_url: string; status: string; notes: string }[]>`SELECT final_url, status, notes FROM stories WHERE story_id = ${id}`
console.error(`\nstatus: ${s?.status} ${s?.notes || ''}`)
console.log(JSON.stringify({ storyId: id, status: s?.status, final_url: s?.final_url, clips_prefix: `https://storage.googleapis.com/${ctx.bucket}/stories/${id}/clips/` }, null, 2))
process.exit(0)
