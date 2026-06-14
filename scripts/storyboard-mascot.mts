/**
 * STORYBOARD generator (cheap — Imagen stills only, NO Veo). For the testing phase:
 * generate the mascot story + per-scene stills + Hinglish dialogue, so we can review
 * and improve the writing BEFORE spending on video.
 *
 * Usage: npx tsx scripts/storyboard-mascot.mts [sourceStoryId] [scenesCount]
 * Output: ~/Desktop/storyboard_<id>.png  + ~/Desktop/storyboard_<id>.md
 */
import { readFileSync, writeFileSync } from 'fs'
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^["']|["']$/g, '')
}
const { sql } = await import('../src/lib/db.ts')
const { loadGcpContext } = await import('../src/lib/pipeline/auth.ts')
const { callGemini } = await import('../src/lib/pipeline/ad-runner.ts')
const { generateImage } = await import('../src/lib/pipeline/imagen.ts')
const { downloadGsUri } = await import('../src/lib/gcs.ts')
const { createCanvas, loadImage, GlobalFonts } = await import('@napi-rs/canvas')
const { join } = await import('path')

const SOURCE = process.argv[2] || 'ad_2026_06_13_c_cinamide_radiance_sunsc_992'
const N = parseInt(process.argv[3] || '6', 10)

GlobalFonts.registerFromPath(join(process.cwd(), 'src/assets/fonts/NotoSansDevanagari-Bold.ttf'), 'NotoDeva')
GlobalFonts.registerFromPath(join(process.cwd(), 'src/assets/fonts/Inter-Bold.ttf'), 'Inter')
const FAM = 'Inter, NotoDeva'

const [pr] = await sql`SELECT operation_ids FROM pipeline_runs WHERE story_id = ${SOURCE}`
if (!pr?.operation_ids?.product) { console.error('source product not found:', SOURCE); process.exit(1) }
const meta = pr.operation_ids
const product = { ...meta.product, duration_sec: N * 8 }
const ctx = await loadGcpContext(meta.credentialId)

let productImage
if (meta.imageGcsUri) {
  try { const b = await downloadGsUri(meta.imageGcsUri); productImage = { data: b.toString('base64'), mimeType: 'image/png' } } catch {}
}

const [cat] = await sql`SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_mascot_drama'`

console.log('1/4 concept...')
const concept = await callGemini(cat.prompt_topic_picker, `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image is the REAL product. Return JSON only.`, ctx, 0.95, productImage)

console.log('2/4 script (' + N + ' scenes)...')
const script: any = await callGemini(cat.prompt_script_writer, `Concept input:\n${JSON.stringify({ ...product, ...concept, scenes_count: N }, null, 2)}\n\nProduce EXACTLY ${N} high-action scenes with Hinglish dialogue. Return JSON.`, ctx, 0.85, productImage)

console.log('3/4 stills (Imagen x' + (N + 1) + ')...')
const world = script.world_description_en || concept.world_description_en
const mascotBrief = (script.mascot_image_prompt || concept.mascot_image_prompt || '').split(/[.,]/).slice(0, 2).join(', ')
const mascotImg = await generateImage(script.mascot_image_prompt || concept.mascot_image_prompt, ctx)
const stills: Buffer[] = []
for (const s of script.scenes) {
  const p = `${world}. ${s.action || s.beat}. Featuring the product mascot (${mascotBrief}). Premium Pixar-style 3D animation, dynamic action, cinematic lighting, vertical 9:16, no text or letters.`
  stills.push(await generateImage(p, ctx))
  process.stdout.write(`  still ${s.scene_num} ✓\n`)
}

console.log('4/4 composing storyboard...')
// ── layout ──
const W = 1200, COLS = 2
const headH = 130, conH = 360, rowH = 520
const rows = Math.ceil(script.scenes.length / COLS)
const H = headH + conH + rows * rowH + 40
const cv = createCanvas(W, H); const c = cv.getContext('2d')
c.fillStyle = '#0d0d12'; c.fillRect(0, 0, W, H)
const wrap = (txt: string, max: number, font: string) => { c.font = font; const w = txt.split(/\s+/); const ls: string[] = []; let l = ''; for (const x of w) { const t = l ? l + ' ' + x : x; if (c.measureText(t).width > max && l) { ls.push(l); l = x } else l = t } if (l) ls.push(l); return ls }

// header
c.fillStyle = '#fff'; c.font = `34px ${FAM}`; c.textBaseline = 'top'
c.fillText('STORYBOARD — ' + (product.name || '').slice(0, 40), 30, 34)
c.fillStyle = '#9aa'; c.font = `20px ${FAM}`; c.fillText((script.ad_title_hindi || '').slice(0, 70), 30, 80)

// concept box
let y = headH
const mImg = await loadImage(mascotImg)
const mw = 180, mh = 320
c.drawImage(mImg, 30, y + 10, mw, mh)
let tx = 240, ty = y + 14
const line = (label: string, val: string, color = '#ddd') => {
  c.fillStyle = '#7af'; c.font = `16px ${FAM}`; c.fillText(label, tx, ty); ty += 22
  c.fillStyle = color; c.font = `19px ${FAM}`
  for (const l of wrap(val || '-', W - tx - 30, `19px ${FAM}`)) { c.fillText(l, tx, ty); ty += 25 }
  ty += 8
}
line('PERSONALITY / VOICE', `${concept.mascot_personality || '-'} · ${concept.voice_persona || '-'}`)
line('WORLD', world || '-')
line('VILLAIN', concept.villain_description_en || '-')
line('TAGLINE (spoken, Hinglish)', script.tagline_hinglish || concept.tagline_hinglish || '-', '#ffd56b')
line('END-CARD (English)', `${script.headline_en || concept.headline_en || '-'}  ·  [${script.cta_en || concept.cta_en || '-'}]`, '#ffd56b')

// scene panels
y = headH + conH
for (let i = 0; i < script.scenes.length; i++) {
  const s = script.scenes[i]
  const col = i % COLS, row = Math.floor(i / COLS)
  const px = 30 + col * ((W - 60) / COLS), py = y + row * rowH
  const sImg = await loadImage(stills[i])
  const sw = 250, sh = 444
  c.drawImage(sImg, px, py + 30, sw, sh)
  const txx = px + sw + 16
  c.fillStyle = '#7af'; c.font = `20px ${FAM}`; c.textBaseline = 'top'
  c.fillText(`Scene ${s.scene_num} · ${s.beat || ''}`, px, py)
  let yy = py + 30
  c.fillStyle = '#bbb'; c.font = `15px ${FAM}`; c.fillText('ACTION', txx, yy); yy += 20
  c.fillStyle = '#ddd'; for (const l of wrap(s.action || '-', (W - 60) / COLS - sw - 30, `17px ${FAM}`)) { c.font = `17px ${FAM}`; c.fillText(l, txx, yy); yy += 22 }
  yy += 12
  c.fillStyle = '#bbb'; c.font = `15px ${FAM}`; c.fillText('DIALOGUE (Hinglish)', txx, yy); yy += 20
  c.fillStyle = '#ffd56b'; for (const l of wrap(s.dialogue || '-', (W - 60) / COLS - sw - 30, `18px ${FAM}`)) { c.font = `18px ${FAM}`; c.fillText(l, txx, yy); yy += 24 }
}

const home = process.env.HOME
const png = `${home}/Desktop/storyboard_${SOURCE.slice(-8)}.png`
writeFileSync(png, cv.toBuffer('image/png'))

// markdown text
const md = [`# Storyboard — ${product.name}`, `**Title:** ${script.ad_title_hindi}`, `**Personality/Voice:** ${concept.mascot_personality} · ${concept.voice_persona}`,
  `**World:** ${world}`, `**Villain:** ${concept.villain_description_en}`, `**Tagline (Hinglish):** ${script.tagline_hinglish}`,
  `**End-card:** ${script.headline_en}  ·  [${script.cta_en}]`, ``,
  ...script.scenes.map((s: any) => `### Scene ${s.scene_num} · ${s.beat}\n- **Action:** ${s.action}\n- **Dialogue:** ${s.dialogue}`)].join('\n')
const mdPath = `${home}/Desktop/storyboard_${SOURCE.slice(-8)}.md`
writeFileSync(mdPath, md)

console.log('\n=== STORYBOARD TEXT ===\n' + md)
console.log('\n✓ image:', png, '\n✓ text :', mdPath)
await sql.end()
process.exit(0)
