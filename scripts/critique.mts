/**
 * Visual critic CLI — score a finished ad by looking at it.
 *   npx tsx scripts/critique.mts <storyId>
 * Prints a scorecard + a viewable storyboard URL.
 */
import { readFileSync } from 'fs'
for (const l of readFileSync('.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).replace(/^["']|["']$/g, '') }

const { sql } = await import('../src/lib/db.ts')
const { loadGcpContext } = await import('../src/lib/pipeline/auth.ts')
const { contextForStory } = await import('../src/lib/gcs.ts')
const { critiqueAd } = await import('../src/lib/pipeline/visual-critic.ts')

const id = process.argv[2]
if (!id) { console.error('usage: npx tsx scripts/critique.mts <storyId>'); process.exit(1) }

const [run] = await sql`SELECT operation_ids FROM pipeline_runs WHERE story_id = ${id}`
const meta = run?.operation_ids || {}
const productImg = meta.cutoutGcsUri || meta.imageGcsUri || null
const productInfo = meta.product ? `${meta.product.name} (${meta.product.category})` : id

let ctx
try { ctx = await loadGcpContext(meta.credentialId) } catch { ctx = await contextForStory(id) }

console.log(`\nCritiquing ${id} ...`)
const s = await critiqueAd(id, ctx, productImg, productInfo)

const bar = (n: number) => '█'.repeat(Math.round(n)) + '░'.repeat(10 - Math.round(n)) + ` ${n}/10`
const mark = s.verdict === 'good' ? '✅' : s.verdict === 'bad' ? '❌' : '⚠️'
console.log(`\n${mark}  VERDICT: ${s.verdict.toUpperCase()}   (overall ${s.overall}/10)\n`)
console.log(`  product fidelity      ${bar(s.product_fidelity)}`)
console.log(`  character consistency ${bar(s.character_consistency)}`)
console.log(`  stays product (vs human) ${bar(s.stays_product)}`)
console.log(`  framing / aspect      ${bar(s.framing)}`)
console.log(`  appeal                ${bar(s.appeal)}`)
console.log(`\n  ${s.summary}`)
if (s.issues?.length) { console.log('\n  Issues:'); s.issues.forEach(i => console.log('   • ' + i)) }
console.log(`\n  storyboard: ${s.storyboard_url}\n`)
await sql.end()
