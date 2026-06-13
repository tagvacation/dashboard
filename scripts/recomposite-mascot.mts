/**
 * Re-run ONLY the compositor on an existing mascot story's clips (no Veo cost) —
 * to preview Polish-Pass changes (transitions, grade, end-card, music) cheaply.
 *
 * Usage: npx tsx scripts/recomposite-mascot.mts <storyId>
 */
import { readFileSync } from 'fs'
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^["']|["']$/g, '')
}
const { sql } = await import('../src/lib/db.ts')
const { loadGcpContext } = await import('../src/lib/pipeline/auth.ts')
const { composeMascotAd } = await import('../src/lib/pipeline/ad-composite.ts')

const STORY = process.argv[2]
if (!STORY) { console.error('Usage: npx tsx scripts/recomposite-mascot.mts <storyId>'); process.exit(1) }

const [pr] = await sql`SELECT operation_ids, script_json FROM pipeline_runs WHERE story_id = ${STORY}`
const [st] = await sql`SELECT scenes_count FROM stories WHERE story_id = ${STORY}`
if (!pr) { console.error('story not found:', STORY); process.exit(1) }
const meta = pr.operation_ids
let script: Record<string, unknown> = {}
try { script = JSON.parse(pr.script_json) } catch { /* defaults below */ }

const ctx = await loadGcpContext(meta.credentialId)
const n = st?.scenes_count || 6
const scenes = Array.from({ length: n }, (_, i) => ({ sceneNum: String(i + 1).padStart(2, '0') }))

console.log(`Re-compositing ${STORY}: ${n} scenes, cutout=${!!meta.cutoutGcsUri}`)
const url = await composeMascotAd({
  storyId: STORY,
  scenes,
  endcard: {
    headlineHi: (script.headline_hi as string) || (script.tagline_hindi as string) || 'चमकती त्वचा का राज़',
    ctaHi: (script.cta_hi as string) || 'अभी ऑर्डर करें',
  },
  productCutoutGcsUri: meta.cutoutGcsUri || null,
  ctx,
})
console.log('\n✓ final_url:', url)
await sql.end()
process.exit(0)
