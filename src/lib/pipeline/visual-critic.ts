/**
 * VISUAL CRITIC — judges a FINISHED ad by looking at it, the way a human would.
 *
 * It builds a storyboard contact sheet from the rendered clips, then asks Gemini Vision to
 * compare those frames against the REAL product and score the ad on the things that actually
 * go wrong with mascot ads: product fidelity, character consistency, "does it morph into a
 * human", framing/aspect, and appeal. Returns a structured scorecard + a verdict.
 *
 * Use it as our QA loop: generate → critique → see good/bad + why, with a viewable storyboard.
 */
import { Storage } from '@google-cloud/storage'
import { spawn } from 'child_process'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getAccessToken } from './auth'
import type { GcpContext } from './auth'
import { fetchWithRetry } from './fetch-retry'

export interface VisualScore {
  product_fidelity: number       // 0-10: does the character clearly look like THIS product?
  character_consistency: number  // 0-10: same character across all frames (no drift)?
  stays_product: number          // 0-10: keeps product form (10) vs morphs into a human (0)
  framing: number                // 0-10: clean 9:16, subject well placed, no squash/bars
  appeal: number                 // 0-10: cute / premium / engaging
  overall: number                // 0-10
  verdict: 'good' | 'mixed' | 'bad'
  issues: string[]
  summary: string
  storyboard_url?: string
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    p.stderr?.on('data', d => { err += d.toString() })
    p.on('error', reject)
    p.on('close', c => c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-200)}`)))
  })
}

/** Download the clips, sample frames, tile into one contact sheet. Uploads + returns it. */
export async function buildStoryboard(storyId: string, ctx: GcpContext): Promise<{ buffer: Buffer; url: string }> {
  const bucket = new Storage({ credentials: ctx.credentials }).bucket(ctx.bucket)
  const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/clips/` })
  const clips = files.filter(f => f.name.endsWith('.mp4')).sort((a, b) => a.name.localeCompare(b.name))
  if (!clips.length) throw new Error('no clips to storyboard')

  const work = join(tmpdir(), `crit-${storyId}-${Date.now()}`)
  await mkdir(work, { recursive: true })
  try {
    let idx = 0
    for (const clip of clips) {
      const local = join(work, `c${idx}.mp4`)
      await writeFile(local, (await clip.download())[0])
      // ~5 frames across each 8s clip → one row per scene
      await runFfmpeg(['-y', '-i', local, '-vf', 'fps=0.6,scale=216:384', '-frames:v', '5', join(work, `f_${String(idx).padStart(2, '0')}_%02d.png`), '-loglevel', 'error'])
      idx++
    }
    const sheet = join(work, 'storyboard.png')
    await runFfmpeg(['-y', '-framerate', '1', '-pattern_type', 'glob', '-i', join(work, 'f_*.png'), '-vf', 'tile=5x' + Math.max(1, clips.length), '-frames:v', '1', sheet, '-loglevel', 'error'])
    const buffer = await readFile(sheet)
    const path = `stories/${storyId}/storyboard.png`
    await bucket.file(path).save(buffer, { contentType: 'image/png', resumable: false, metadata: { cacheControl: 'public, max-age=60' } })
    return { buffer, url: `https://storage.googleapis.com/${ctx.bucket}/${path}?v=${Date.now()}` }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

const RUBRIC = `You are a STRICT creative QA director for AI product-mascot video ads. You are shown TWO images:
  • IMAGE 1 = the REAL product (what the mascot must be based on).
  • IMAGE 2 = a STORYBOARD: a grid of frames sampled from the generated mascot ad (read left→right, top→bottom; each ROW is one scene over time).

Judge ONLY what you see. Score each 0-10 (10 = perfect):
  • product_fidelity      — does the mascot clearly look like THIS exact product (shape, colours, label)?
  • character_consistency — is it the SAME character in every frame, or does it drift/change between frames?
  • stays_product         — does it KEEP the product's form? 10 = always the product; 0 = it morphs into a HUMAN / humanoid / superhero at any point. (Look hard for any frame where it became a person.)
  • framing               — clean vertical 9:16, subject well-placed, no squashing, no letterbox/pillarbox bars, not tiny/floating.
  • appeal                — cute, premium, engaging, on-brand.
Then:
  • overall  — 0-10 holistic.
  • verdict  — "good" (overall >=7 and stays_product >=7), "bad" (overall <=4 OR stays_product <=4), else "mixed".
  • issues   — up to 4 SHORT concrete problems, each naming the row/frame if relevant (e.g. "row 4: mascot became a human superhero").
  • summary  — one sentence.

Return STRICT JSON only:
{ "product_fidelity":n, "character_consistency":n, "stays_product":n, "framing":n, "appeal":n, "overall":n, "verdict":"good|mixed|bad", "issues":["..."], "summary":"..." }`

export async function visionJudge(productB64: string, productMime: string, sheetB64: string, productInfo: string, ctx: GcpContext): Promise<Omit<VisualScore, 'storyboard_url'>> {
  const token = await getAccessToken(ctx)
  const url = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/gemini-2.5-flash:generateContent`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: RUBRIC }] },
      contents: [{
        role: 'user', parts: [
          { text: `Product: ${productInfo}\n\nIMAGE 1 = the real product:` },
          { inlineData: { mimeType: productMime, data: productB64 } },
          { text: 'IMAGE 2 = the generated ad storyboard:' },
          { inlineData: { mimeType: 'image/png', data: sheetB64 } },
          { text: 'Score it. Return JSON only.' },
        ],
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json' },
    }),
  }, { label: 'visual-critic', timeoutMs: 120_000 })
  if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  const finish = data.candidates?.[0]?.finishReason
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error(`vision: empty response (finishReason=${finish})`)
  try { return JSON.parse(text) } catch { /* fall through to extraction */ }
  const m = String(text).match(/\{[\s\S]*\}/)
  if (m) return JSON.parse(m[0])
  throw new Error(`vision: unparseable (finishReason=${finish}) raw: ${String(text).slice(0, 400)}`)
}

/** Full visual critique of a finished story: builds the storyboard, judges it vs the product. */
export async function critiqueAd(storyId: string, ctx: GcpContext, productImageGcsUri: string | null, productInfo = ''): Promise<VisualScore> {
  const { downloadGsUri } = await import('../gcs')
  const { buffer: sheet, url } = await buildStoryboard(storyId, ctx)

  let productB64 = ''
  let productMime = 'image/png'
  if (productImageGcsUri) {
    try {
      const b = await downloadGsUri(productImageGcsUri, ctx)
      productB64 = b.toString('base64')
      productMime = productImageGcsUri.endsWith('.jpg') || productImageGcsUri.endsWith('.jpeg') ? 'image/jpeg' : productImageGcsUri.endsWith('.webp') ? 'image/webp' : 'image/png'
    } catch { /* judge without the product reference if unavailable */ }
  }

  const score = await visionJudge(productB64, productMime, sheet.toString('base64'), productInfo, ctx)
  return { ...score, storyboard_url: url }
}
