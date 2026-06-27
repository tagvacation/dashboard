/**
 * Lab — the reusable "generate a test ad + score it" core, shared by the CLI and the MCP server.
 * Copies a product from an existing story, runs the draft (+ optional Veo render), scores it with
 * the visual critic, and logs the result to the shared `experiments` table.
 */
import { spawn } from 'child_process'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Storage } from '@google-cloud/storage'
import { sql, pipelineDb, experimentsDb } from '../db'
import { loadGcpContext } from './auth'
import { downloadGsUri } from '../gcs'
import { runMascotDraft } from './draft-runner'
import { runMascotAdPipeline } from './mascot-runner'
import { critiqueAd, visionJudge, type VisualScore } from './visual-critic'

export interface LabResult { storyId: string; score: VisualScore; videoUrl?: string; storyboardUrl?: string }

function runFfmpeg(a: string[]): Promise<void> {
  return new Promise((res, rej) => { const p = spawn('ffmpeg', a); let e = ''; p.stderr?.on('data', d => e += d); p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(e.slice(-200)))) })
}

/** Critique the DRAFT stills (cheap, no Veo): tile the storyboard PNGs + vision-judge them. */
async function critiqueStills(storyId: string, ctx: Awaited<ReturnType<typeof loadGcpContext>>, productImg: string | null, info: string): Promise<VisualScore> {
  const bucket = new Storage({ credentials: ctx.storageCredentials }).bucket(ctx.bucket)
  const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/storyboard/` })
  const pngs = files.filter(f => /scene_\d+\.png$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (!pngs.length) throw new Error('no stills to critique')
  const work = join(tmpdir(), `lab-${storyId}`); await mkdir(work, { recursive: true })
  try {
    let i = 0; for (const f of pngs) { await writeFile(join(work, `s${String(i).padStart(2, '0')}.png`), (await f.download())[0]); i++ }
    await runFfmpeg(['-y', '-framerate', '1', '-pattern_type', 'glob', '-i', join(work, 's*.png'), '-vf', `scale=216:384,tile=${pngs.length}x1`, '-frames:v', '1', join(work, 'sheet.png'), '-loglevel', 'error'])
    const sheet = (await readFile(join(work, 'sheet.png'))).toString('base64')
    let pb = '', pm = 'image/png'
    if (productImg) { const b = await downloadGsUri(productImg, ctx); pb = b.toString('base64'); pm = productImg.endsWith('.jpg') || productImg.endsWith('.jpeg') ? 'image/jpeg' : 'image/png' }
    const s = await visionJudge(pb, pm, sheet, info, ctx)
    return { ...s, storyboard_url: `https://storage.googleapis.com/${ctx.bucket}/stories/${storyId}/storyboard/scene_01.png` }
  } finally { await rm(work, { recursive: true, force: true }).catch(() => {}) }
}

/** Run a mascot test on a product (copy of an existing story). Logs to the experiments table. */
export async function runMascotTest(
  sourceStoryId: string, opts: { render?: boolean; scenes?: number; agent?: string; change?: string } = {},
): Promise<LabResult> {
  const scenes = Math.max(2, Math.min(8, opts.scenes || 3))
  const [src] = await sql<{ operation_ids: { product?: { name?: string; duration_sec?: number }; credentialId?: string; cutoutGcsUri?: string; imageGcsUri?: string }; user_id: string }[]>`
    SELECT pr.operation_ids, s.user_id FROM pipeline_runs pr JOIN stories s USING(story_id) WHERE pr.story_id = ${sourceStoryId}`
  if (!src?.operation_ids?.product) throw new Error('source product not found: ' + sourceStoryId)
  // Storage always uses the main account (per directive). credentialId stays '' → main bucket.
  // (Compute-account spreading for Vertex quota is a separate future step — see MCP.md.)
  const meta = { ...src.operation_ids, credentialId: '', product: { ...src.operation_ids.product, duration_sec: scenes * 8 } }
  const name = meta.product.name || sourceStoryId
  const id = `test_${Date.now()}`
  await sql`INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, user_id, gcp_credential_id) VALUES (${id}, ${name + ' — Mascot Ad'}, 'ai_ad', 'init', ${'stories/' + id + '/'}, 'ai_ad_mascot_drama', ${src.user_id}, ${meta.credentialId || ''})`
  await pipelineDb.create(id)
  await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(meta)))} WHERE story_id = ${id}`

  await runMascotDraft(id)
  const ctx = await loadGcpContext(meta.credentialId)
  const productImg = meta.cutoutGcsUri || meta.imageGcsUri || null

  let score: VisualScore
  if (opts.render) {
    await sql`UPDATE pipeline_runs SET operation_ids = (operation_ids || ${sql.json({ reuseScript: true })}) WHERE story_id = ${id}`
    await runMascotAdPipeline(id)
    score = await critiqueAd(id, ctx, productImg, name)
  } else {
    score = await critiqueStills(id, ctx, productImg, name)
  }

  const [st] = await sql<{ final_url: string }[]>`SELECT final_url FROM stories WHERE story_id = ${id}`
  await experimentsDb.log({
    agent: opts.agent || '', story_id: id, change: opts.change || (opts.render ? 'full render' : 'stills'),
    verdict: score.verdict, overall: score.overall,
    scores: { product_fidelity: score.product_fidelity, character_consistency: score.character_consistency, stays_product: score.stays_product, framing: score.framing, appeal: score.appeal },
    notes: score.summary,
  })
  return { storyId: id, score, videoUrl: st?.final_url || undefined, storyboardUrl: score.storyboard_url }
}
