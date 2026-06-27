/**
 * Validate live-model ANCHORING before wiring the full pipeline.
 *
 * Put your reference photos in a folder (default: ~/Desktop/model-test/):
 *   face.jpg      (required — identity anchor; face/portrait)
 *   front.jpg     (front full-body of the outfit/product)
 *   back.jpg      (back view)            [optional]
 *   side.jpg      (side view)            [optional]
 *   closeup.jpg   (fabric/detail close)  [optional]
 * (any of .jpg/.jpeg/.png/.webp)
 *
 * For each view present it composes [face + view] via nano-banana into one still — the SAME person
 * wearing the EXACT outfit from that view, framed full-body. Outputs to <folder>/out/ + a contact
 * sheet so we can judge face consistency + outfit fidelity.
 *
 *   npx tsx scripts/test-model-anchor.mts [folder] [--account <id>]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).replace(/^["']|["']$/g, '') }

const args = process.argv.slice(2)
const ai = args.indexOf('--account')
const account = ai >= 0 ? args[ai + 1] : ''
const folder = args.find(a => !a.startsWith('--') && a !== account) || join(homedir(), 'Desktop', 'model-test')

const auth = await import('../src/lib/pipeline/auth.ts')
const { composeImageNano } = await import('../src/lib/pipeline/imagen.ts')

const mimeOf = (f: string) => f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
const find = (stem: string): string | null => {
  const files = readdirSync(folder)
  const m = files.find(f => f.toLowerCase().replace(/\.(jpg|jpeg|png|webp)$/, '') === stem)
  return m ? join(folder, m) : null
}
const load = (p: string) => ({ data: readFileSync(p), mimeType: mimeOf(p.toLowerCase()) })

const facePath = find('face')
if (!facePath) { console.error(`No face.* in ${folder}. Add face.jpg (+ front/back/side/closeup).`); process.exit(1) }
const face = load(facePath)

const VIEWS: Record<string, string> = {
  front: 'viewed from the FRONT (the model faces the camera)',
  back: 'viewed from BEHIND (the back of the outfit faces the camera; face turned away / not visible)',
  side: 'viewed from the SIDE (a 3/4 side profile)',
  closeup: 'a CLOSE-UP detail shot of the outfit fabric/texture on the upper body',
}

const outDir = join(folder, 'out'); mkdirSync(outDir, { recursive: true })
const ctx = await auth.loadGcpContext(account)
console.error(`Compute: ${ctx.projectId} | folder: ${folder}`)

const made: string[] = []
for (const [view, desc] of Object.entries(VIEWS)) {
  const vp = find(view)
  if (!vp) { console.error(`(skip ${view} — no ${view}.*)`); continue }
  const framing = view === 'closeup'
    ? 'Tight close-up on the fabric/detail, premium and crisp.'
    : 'Full-body fashion shot; the model fills ~75% of a vertical 9:16 frame, standing naturally; clean stylish lifestyle setting; soft flattering lighting; slightly wide lens so the model is prominent, not tiny/far.'
  const prompt = `You are given TWO photos. The FIRST is the MODEL'S FACE/identity. The SECOND shows the OUTFIT/PRODUCT ${desc}.
Create ONE photorealistic image of the SAME person from the first photo, wearing/using the EXACT same outfit/product shown in the second photo, ${desc}.
ABSOLUTE FIDELITY: keep the face & identity 100% from the first photo (same face, hair, skin), and the outfit 100% from the second photo (same colours, pattern, cut, fabric, every detail). Do not invent or restyle anything.
${framing}
Photorealistic, natural skin, high detail, professional fashion photography. No text, no watermark, no logos.`
  try {
    console.error(`composing ${view}…`)
    const buf = await composeImageNano([face, load(vp)], prompt, ctx)
    const out = join(outDir, `still_${view}.png`); writeFileSync(out, buf); made.push(out)
    console.error(`  ✓ ${out}`)
  } catch (e) { console.error(`  ✗ ${view}: ${e instanceof Error ? e.message : e}`) }
}

if (made.length) {
  const sheet = join(outDir, 'contact_sheet.png')
  await new Promise<void>((res, rej) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...made.flatMap(m => ['-i', m]),
      '-filter_complex', `${made.map((_, i) => `[${i}:v]scale=300:534[v${i}]`).join(';')};${made.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${made.length}`,
      '-frames:v', '1', sheet])
    p.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c)))
  }).catch(e => console.error('sheet failed:', e.message))
  console.error(`\n▶ Contact sheet: ${sheet}`)
}
process.exit(0)
