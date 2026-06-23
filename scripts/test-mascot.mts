/**
 * Mascot quality test harness — iterate the mascot pipeline measured by the visual critic.
 *
 * Copies a product from an existing story, runs the DRAFT (concept + consistent storyboard
 * stills, no Veo), then scores it with the visual critic. Add --render to also approve →
 * render the video (Veo) and score the actual clips.
 *
 *   npx tsx scripts/test-mascot.mts <sourceStoryId> [--scenes N] [--render] [--keep]
 *
 *   (default)   cheap: draft + stills + critic on the STILLS (no Veo, ~₹30)
 *   --render    full:  draft → approve → Veo render → critic on the VIDEO (~₹400 for 3 scenes)
 *   --scenes N  number of scenes (default 3 → ~₹ cheaper); maps to duration N*8s
 *   --keep      don't delete the test story afterward (default deletes DB row)
 *
 * Test stories are prefixed `test_` and are disposable.
 */
import { readFileSync } from 'fs'
for (const l of readFileSync('.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).replace(/^["']|["']$/g, '') }

const { spawn } = await import('child_process')
const { mkdir, writeFile, readFile, rm } = await import('fs/promises')
const { tmpdir } = await import('os'); const { join } = await import('path')
const { Storage } = await import('@google-cloud/storage')
const { sql, pipelineDb } = await import('../src/lib/db.ts')
const { runMascotDraft } = await import('../src/lib/pipeline/draft-runner.ts')
const { runMascotAdPipeline } = await import('../src/lib/pipeline/mascot-runner.ts')
const { critiqueAd, visionJudge } = await import('../src/lib/pipeline/visual-critic.ts')
const { loadGcpContext } = await import('../src/lib/pipeline/auth.ts')
const { downloadGsUri } = await import('../src/lib/gcs.ts')

const args = process.argv.slice(2)
const SOURCE = args.find(a => !a.startsWith('--'))
const RENDER = args.includes('--render')
const KEEP = args.includes('--keep')
const _si = args.indexOf('--scenes')
const SCENES = _si >= 0 ? (parseInt(args[_si + 1], 10) || 3) : 3
if (!SOURCE) { console.error('usage: npx tsx scripts/test-mascot.mts <sourceStoryId> [--scenes N] [--render] [--keep]'); process.exit(1) }

const ff = (a: string[]) => new Promise<void>((res, rej) => { const p = spawn('ffmpeg', a); let e = ''; p.stderr?.on('data', d => e += d); p.on('close', c => c === 0 ? res() : rej(new Error(e.slice(-200)))) })
const bar = (n: number) => '█'.repeat(Math.round(n)) + '░'.repeat(10 - Math.round(n)) + ` ${n}/10`

const [src] = await sql`SELECT pr.operation_ids, s.user_id FROM pipeline_runs pr JOIN stories s USING(story_id) WHERE pr.story_id = ${SOURCE}`
if (!src?.operation_ids?.product) { console.error('source product not found:', SOURCE); process.exit(1) }
const meta = { ...src.operation_ids, product: { ...src.operation_ids.product, duration_sec: SCENES * 8 } }
const id = `test_${Date.now()}`
await sql`INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, user_id, gcp_credential_id) VALUES (${id}, ${meta.product.name + ' — Mascot Ad'}, 'ai_ad', 'init', ${'stories/' + id + '/'}, 'ai_ad_mascot_drama', ${src.user_id}, ${meta.credentialId || ''})`
await pipelineDb.create(id)
await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(meta)))} WHERE story_id = ${id}`
const ctx = await loadGcpContext(meta.credentialId)
const productImg = meta.cutoutGcsUri || meta.imageGcsUri || null

console.log(`\n▶ ${id}  (${meta.product.name}, ${SCENES} scenes, ${RENDER ? 'FULL render' : 'stills only'})`)
console.log('1) draft (concept + consistent stills, no Veo)...')
await runMascotDraft(id)

let score
if (RENDER) {
  console.log('2) approve → render video from stills (Veo)...')
  await sql`UPDATE pipeline_runs SET operation_ids = (operation_ids || ${sql.json({ reuseScript: true })}) WHERE story_id = ${id}`
  await runMascotAdPipeline(id)
  console.log('3) critic (on the video)...')
  score = await critiqueAd(id, ctx, productImg, meta.product.name)
} else {
  console.log('2) critic (on the stills)...')
  const bucket = new Storage({ credentials: ctx.credentials }).bucket(ctx.bucket)
  const [files] = await bucket.getFiles({ prefix: `stories/${id}/storyboard/` })
  const pngs = files.filter(f => /scene_\d+\.png$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))
  const work = join(tmpdir(), id); await mkdir(work, { recursive: true })
  let i = 0; for (const f of pngs) { await writeFile(join(work, `s${String(i).padStart(2, '0')}.png`), (await f.download())[0]); i++ }
  await ff(['-y', '-framerate', '1', '-pattern_type', 'glob', '-i', join(work, 's*.png'), '-vf', `scale=216:384,tile=${pngs.length}x1`, '-frames:v', '1', join(work, 'sheet.png'), '-loglevel', 'error'])
  const sheet = (await readFile(join(work, 'sheet.png'))).toString('base64')
  let pb = '', pm = 'image/png'
  if (productImg) { const b = await downloadGsUri(productImg, ctx); pb = b.toString('base64'); pm = productImg.endsWith('.jpg') || productImg.endsWith('.jpeg') ? 'image/jpeg' : 'image/png' }
  const s = await visionJudge(pb, pm, sheet, meta.product.name, ctx)
  score = { ...s, storyboard_url: `https://storage.googleapis.com/${ctx.bucket}/stories/${id}/storyboard/scene_01.png` }
  await rm(work, { recursive: true, force: true }).catch(() => {})
}

const mark = score.verdict === 'good' ? '✅' : score.verdict === 'bad' ? '❌' : '⚠️'
console.log(`\n${mark} VERDICT: ${score.verdict.toUpperCase()}  (overall ${score.overall}/10)`)
console.log('  product fidelity      ', bar(score.product_fidelity))
console.log('  character consistency ', bar(score.character_consistency))
console.log('  stays product (vs human)', bar(score.stays_product))
console.log('  framing / aspect      ', RENDER ? bar(score.framing) : 'n/a (stills mode — framing judged on the video render)')
console.log('  appeal                ', bar(score.appeal))
console.log('\n  ' + score.summary)
;(score.issues || []).forEach(x => console.log('   • ' + x))
const [st] = await sql`SELECT final_url FROM stories WHERE story_id = ${id}`
if (st?.final_url) console.log('\n  video:', st.final_url)
console.log('  storyboard:', score.storyboard_url)

if (!KEEP) {
  await sql`DELETE FROM scene_jobs WHERE story_id = ${id}`
  await sql`DELETE FROM pipeline_runs WHERE story_id = ${id}`
  await sql`DELETE FROM stories WHERE story_id = ${id}`
  console.log('\n  (test story deleted; pass --keep to retain)')
}
await sql.end()
