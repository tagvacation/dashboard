import { readFileSync } from 'fs'
for (const l of readFileSync('.env','utf8').split('\n')){const i=l.indexOf('=');if(i>0&&!l.startsWith('#'))process.env[l.slice(0,i).trim()]??=l.slice(i+1).replace(/^["']|["']$/g,'')}
const { sql, pipelineDb } = await import('../src/lib/db.ts')
const { runMascotDraft } = await import('../src/lib/pipeline/draft-runner.ts')
const { runMascotAdPipeline } = await import('../src/lib/pipeline/mascot-runner.ts')
const { critiqueAd } = await import('../src/lib/pipeline/visual-critic.ts')
const { loadGcpContext } = await import('../src/lib/pipeline/auth.ts')
const SOURCE = 'ad_2026_06_20_brightening_sunscreen_spf_456'
const [src] = await sql`SELECT pr.operation_ids, s.user_id FROM pipeline_runs pr JOIN stories s USING(story_id) WHERE pr.story_id=${SOURCE}`
if(!src?.operation_ids?.product){console.error('source meta not found');process.exit(1)}
const meta0 = { ...src.operation_ids, product: { ...src.operation_ids.product, duration_sec: 24 } } // 3 scenes = cheaper test
const id = `stilltest_${Date.now()}`
await sql`INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, user_id, gcp_credential_id) VALUES (${id}, ${meta0.product.name+' — Mascot Ad'}, 'ai_ad', 'init', ${'stories/'+id+'/'}, 'ai_ad_mascot_drama', ${src.user_id}, ${meta0.credentialId||''})`
await pipelineDb.create(id)
await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(meta0)))} WHERE story_id=${id}`
console.log('STEP 1/3 draft:', id); await runMascotDraft(id)
console.log('STEP 2/3 approve → render FROM stills (Veo)...')
const [run] = await sql`SELECT operation_ids FROM pipeline_runs WHERE story_id=${id}`
const meta = { ...run.operation_ids, reuseScript: true }
await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(meta)))} WHERE story_id=${id}`
await runMascotAdPipeline(id)
console.log('STEP 3/3 critic...')
const ctx = await loadGcpContext(meta.credentialId)
const s = await critiqueAd(id, ctx, meta.cutoutGcsUri||meta.imageGcsUri||null, meta.product.name)
console.log('\n=== RESULT ===\nverdict:', s.verdict, '| overall', s.overall+'/10 | stays_product', s.stays_product+'/10 | fidelity', s.product_fidelity+'/10')
console.log('summary:', s.summary); (s.issues||[]).forEach(i=>console.log('  •',i))
const [st]=await sql`SELECT final_url FROM stories WHERE story_id=${id}`
console.log('video:', st?.final_url, '\nstoryboard:', s.storyboard_url)
await sql.end()
