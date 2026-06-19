/**
 * Veo "doctor" — isolate WHY clips get content-filtered, separating:
 *   P1 (text-only)            → is the service/account healthy? (rules out IP/quota/project block)
 *   P2 (image + neutral)      → does the INPUT IMAGE itself trip the filter (real-face safety)?
 *   P3 (image + scene prompt) → does our PROMPT wording trip it?
 *
 * The image is sent as raw BYTES (not a gcsUri) so it works on ANY account regardless of
 * bucket access — that makes cross-account comparison valid: if two accounts behave
 * identically, the cause is CONTENT (image/prompt), not IP/account throttling.
 *
 * Usage:
 *   npx tsx scripts/veo-doctor.mts --story <storyId> [--creds id1,id2] [--model name]
 *                                   [--image gs://...] [--prompt "..."] [--probes p1,p2,p3] [--dry]
 *
 * Examples:
 *   npx tsx scripts/veo-doctor.mts --story ad_2026_06_19_women_poly_cotton_green_y_487
 *   npx tsx scripts/veo-doctor.mts --story <id> --creds accountA,accountB   # compare two accounts
 *   npx tsx scripts/veo-doctor.mts --story <id> --dry                       # just print what it would test (free)
 */
import { readFileSync } from 'fs'
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^["']|["']$/g, '')
}

const { sql, gcpCredentialsDb } = await import('../src/lib/db.ts')
const { contextFromCredential, loadGcpContext } = await import('../src/lib/pipeline/auth.ts')
const { contextForStory, downloadGsUri } = await import('../src/lib/gcs.ts')
const { submitVeoClip, pollVeoOperation } = await import('../src/lib/pipeline/veo.ts')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const has = (k: string) => process.argv.includes(k)

const STORY = arg('--story')
const MODEL = arg('--model') || process.env.MODEL_VEO_MODEL || 'veo-3.1-generate-001'
const PROBES = (arg('--probes') || 'p1,p2,p3').split(',').map(s => s.trim())
const EXTRA_CREDS = (arg('--creds') || '').split(',').map(s => s.trim()).filter(Boolean)
const DRY = has('--dry')

const NEUTRAL = 'The subject stays in place with gentle, subtle, natural movement; soft natural lighting; calm and still; vertical 9:16.'
const TEXT_ONLY = 'A peaceful sunrise over rolling green hills, a slow gentle camera push-in, soft natural morning light, cinematic, vertical 9:16.'
const mimeFor = (u: string) => u.endsWith('.jpg') || u.endsWith('.jpeg') ? 'image/jpeg' : u.endsWith('.webp') ? 'image/webp' : 'image/png'

if (!STORY && !arg('--image')) { console.error('Need --story <id> (or --image gs://...)'); process.exit(1) }

// ── Resolve the base image + a representative (failing) scene prompt from the story ──
let storyCtx: any = null
let imageUri = arg('--image') || ''
let scenePrompt = arg('--prompt') || ''
if (STORY) {
  const [run] = await sql`SELECT operation_ids, script_json FROM pipeline_runs WHERE story_id = ${STORY}`
  const meta = run?.operation_ids || {}
  // The story's account lives either in stories.gcp_credential_id (contextForStory) OR, for the
  // ad pipelines, in pipeline_runs.operation_ids.credentialId. Try both.
  storyCtx = await contextForStory(STORY).catch(() => null)
  if (!storyCtx && meta.credentialId) storyCtx = await loadGcpContext(meta.credentialId).catch(() => null)
  if (storyCtx) console.log('resolved account:', storyCtx.projectId)
  else console.warn('⚠ could not resolve the story\'s account (pass --creds <id>)')
  if (!imageUri) imageUri = (meta.modelImages?.[0]) || meta.imageGcsUri || ''
  if (!scenePrompt) {
    let script: any = {}; try { script = JSON.parse(run?.script_json || '{}') } catch {}
    // prefer a scene that actually failed/filtered
    const jobs = await sql`SELECT scene_num, status FROM scene_jobs WHERE story_id = ${STORY} ORDER BY scene_num, attempt`
    const badNum = jobs.find((j: any) => j.status === 'filtered' || j.status === 'failed')?.scene_num
    const scenes = script.scenes || []
    const pick = scenes.find((s: any) => String(s.scene_num).padStart(2, '0') === badNum) || scenes[0]
    scenePrompt = pick?.video_prompt || ''
  }
}

console.log('\n══════════ Veo Doctor ══════════')
console.log('model      :', MODEL)
console.log('story      :', STORY || '(none)')
console.log('image      :', imageUri || '(none)')
console.log('scene len  :', scenePrompt.length, 'chars')
console.log('probes     :', PROBES.join(', '))

// Download the image ONCE as bytes (account-independent) using the story's ctx.
let imageB64 = ''
if ((PROBES.includes('p2') || PROBES.includes('p3')) && imageUri) {
  if (!storyCtx) { console.error('No ctx to download the image; pass --creds to supply one'); process.exit(1) }
  const buf = await downloadGsUri(imageUri, storyCtx)
  imageB64 = buf.toString('base64')
  console.log('image bytes:', Math.round(buf.length / 1024), 'KB')
}

// Build the list of accounts to test.
const accounts: { label: string; ctx: any }[] = []
if (storyCtx) accounts.push({ label: `story-account(${storyCtx.projectId})`, ctx: storyCtx })
for (const id of EXTRA_CREDS) {
  const cred = await gcpCredentialsDb.get(id)
  if (!cred) { console.warn('  (credential not found, skipping):', id); continue }
  accounts.push({ label: `${id}(${cred.project_id})`, ctx: contextFromCredential(cred) })
}
if (!accounts.length) { console.error('No accounts resolved to test'); process.exit(1) }

if (DRY) {
  console.log('\n--- DRY RUN (no Veo calls) ---')
  console.log('accounts:', accounts.map(a => a.label).join(', '))
  console.log('\nP3 prompt:\n', scenePrompt)
  process.exit(0)
}

type Probe = { id: string; label: string; prompt: string; withImage: boolean }
const ALL: Probe[] = [
  { id: 'p1', label: 'text-only (service health)', prompt: TEXT_ONLY, withImage: false },
  { id: 'p2', label: 'image + neutral prompt', prompt: NEUTRAL, withImage: true },
  { id: 'p3', label: 'image + actual scene prompt', prompt: scenePrompt, withImage: true },
]
const toRun = ALL.filter(p => PROBES.includes(p.id) && (!p.withImage || imageB64) && p.prompt)

async function runProbe(ctx: any, p: Probe): Promise<string> {
  const imageRef = p.withImage ? { bytesBase64Encoded: imageB64, mimeType: mimeFor(imageUri) } : undefined
  let opId: string
  try { opId = await submitVeoClip(p.prompt, ctx, MODEL, imageRef, false) }
  catch (e: any) { return `SUBMIT-ERR: ${String(e.message || e).slice(0, 120)}` }
  for (let i = 0; i < 18; i++) {
    await sleep(20_000)
    let r: any
    try { r = await pollVeoOperation(opId, ctx) } catch (e: any) { return `POLL-ERR: ${String(e.message || e).slice(0, 120)}` }
    if (!r.done) continue
    if (r.base64) return 'PASS ✓ (video generated)'
    return `FILTERED ✗: ${String(r.error || 'filtered').slice(0, 140)}`
  }
  return 'TIMEOUT'
}

const results: Record<string, Record<string, string>> = {}
for (const acc of accounts) {
  results[acc.label] = {}
  for (const p of toRun) {
    process.stdout.write(`\n[${acc.label}] ${p.id} ${p.label} ... `)
    const res = await runProbe(acc.ctx, p)
    results[acc.label][p.id] = res
    process.stdout.write(res)
  }
}

// ── Verdict ──
console.log('\n\n══════════ RESULTS ══════════')
for (const acc of accounts) {
  console.log(`\n${acc.label}`)
  for (const p of toRun) console.log(`  ${p.id} ${p.label.padEnd(34)} ${results[acc.label][p.id]}`)
}

console.log('\n══════════ VERDICT ══════════')
const a0 = accounts[0].label
const pass = (id: string, label = a0) => /PASS/.test(results[label]?.[id] || '')
const filt = (id: string, label = a0) => /FILTERED/.test(results[label]?.[id] || '')
if (PROBES.includes('p1') && !pass('p1')) {
  console.log('• P1 (text-only) did NOT pass → the account/service itself is blocked or throttled (IP/quota/project),')
  console.log('  NOT your prompt or image. Check quota/billing/abuse status for this project.')
} else if (PROBES.includes('p2') && filt('p2')) {
  console.log('• P1 passes but P2 (image + neutral) is FILTERED → the INPUT IMAGE is the trigger')
  console.log('  (Veo\'s real-human-face safety check on the reference image). Not your prompt, not IP.')
  console.log('  → Use an Imagen-generated synthetic model, or pre-validate the base image once before generating all scenes.')
} else if (PROBES.includes('p3') && filt('p3')) {
  console.log('• P1+P2 pass but P3 (scene prompt) is FILTERED → your PROMPT wording is the trigger.')
  console.log('  → Inspect the P3 prompt above for risky terms; soften and re-test.')
} else {
  console.log('• Everything that ran passed. The earlier failures were likely the intermittent per-image coin-flip')
  console.log('  (same image sometimes passes, sometimes filters). Re-roll handles it.')
}
if (accounts.length > 1) {
  const same = toRun.every(p => accounts.every(a => (results[a.label][p.id]?.split(':')[0]) === (results[a0][p.id]?.split(':')[0])))
  console.log(same
    ? '• Both accounts behaved IDENTICALLY → confirms the cause is CONTENT (image/prompt), not IP/account.'
    : '• Accounts DIFFERED → the cause is account/project-specific (quota, allow-listing, or abuse flag), not the content.')
}

await sql.end()
