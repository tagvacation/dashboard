/**
 * Generation worker — runs the heavy pipeline (Veo polling, Imagen, ffmpeg compositing)
 * OFF the web process so the dashboard stays responsive.
 *
 * Deploy as a SECOND Railway service in the same project (same repo/image), start command:
 *   npm run worker
 * and set `USE_WORKER=1` on the WEB service so it enqueues instead of running inline.
 * Needs the same env as the web app: DATABASE_URL, APP_ENCRYPTION_KEY, etc.
 *
 * Local: `npm run worker` (reads .env). One job at a time (ffmpeg is CPU-heavy).
 */
import { readFileSync } from 'fs'
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).replace(/^["']|["']$/g, '')
  }
} catch { /* env provided by the host (Railway) — no .env file */ }

const { sql } = await import('../src/lib/db.ts')
const { claimNextJob, dispatchJob, requeueStale } = await import('../src/lib/pipeline/queue.ts')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let stopping = false
// First signal = graceful (finish current job). Second = force quit immediately (a running
// generation can take minutes, so don't make the user wait if they really want out).
function shutdown(sig: string) {
  if (stopping) { console.log(`[worker] ${sig} again — force quit`); process.exit(0) }
  stopping = true
  console.log(`[worker] ${sig} — finishing current job, then exiting. Press Ctrl+C again to force quit now.`)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

console.log('[worker] started; polling for queued jobs…')
const recovered = await requeueStale().catch(() => 0)
if (recovered) console.log(`[worker] requeued ${recovered} stale job(s)`)

let idleTicks = 0
while (!stopping) {
  let job = null
  try { job = await claimNextJob() } catch (e) { console.error('[worker] claim error:', e instanceof Error ? e.message : e) }

  if (!job) {
    idleTicks++
    if (idleTicks % 30 === 0) { const n = await requeueStale().catch(() => 0); if (n) console.log(`[worker] requeued ${n} stale job(s)`) }
    await sleep(2000)
    continue
  }

  idleTicks = 0
  console.log(`[worker] ▶ ${job.job_type} ${job.story_id}`)
  const t0 = Date.now()
  try {
    await dispatchJob(job.story_id, job.job_type, job.params)
    console.log(`[worker] ✓ ${job.story_id} (${Math.round((Date.now() - t0) / 1000)}s)`)
  } catch (e) {
    console.error(`[worker] ✗ ${job.story_id}:`, e instanceof Error ? e.message : e)
    // The runners set status='failed' themselves on error; nothing else to do here.
  }
}

console.log('[worker] stopped')
await sql.end().catch(() => {})
process.exit(0)
