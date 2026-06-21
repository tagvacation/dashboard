/**
 * Job queue for the web/worker split.
 *
 * Heavy generation (Veo polling, Imagen, ffmpeg compositing) must NOT run inside the web
 * server process — it pegs CPU and makes the dashboard crawl. Instead:
 *   • web:   `runOrEnqueue()` sets the pipeline_run to status='queued' (instant) and returns.
 *   • worker: a separate Railway service polls `claimNextJob()` and runs `dispatchJob()`.
 *
 * Toggle with env `USE_WORKER=1` (set on the WEB service). When unset (local dev, or before
 * the worker is deployed) it runs the pipeline INLINE — same behaviour as before — so nothing
 * breaks if no worker is running.
 */
import { sql } from '../db'

export type JobType = 'ad' | 'story' | 'draft'
export interface JobParams { categoryId?: string; credentialId?: string }

const workerMode = () => process.env.USE_WORKER === '1'

/** Mark a created pipeline_run as queued for the worker (stores its type + params). */
export async function enqueueJob(storyId: string, jobType: JobType, params: JobParams = {}): Promise<void> {
  // Plain literal (string|null values) so it satisfies postgres' JSONValue type.
  const payload = { jobParams: { categoryId: params.categoryId ?? null, credentialId: params.credentialId ?? null } }
  await sql`
    UPDATE pipeline_runs
    SET job_type = ${jobType},
        status = 'queued',
        operation_ids = COALESCE(operation_ids, '{}'::jsonb) || ${sql.json(payload)},
        updated_at = NOW()
    WHERE story_id = ${storyId}`
}

/** Run the correct runner for a job. Used by the worker AND by the inline (no-worker) path. */
export async function dispatchJob(storyId: string, jobType: JobType, params: JobParams = {}): Promise<void> {
  if (jobType === 'ad') {
    const { runAdPipeline } = await import('./ad-runner')
    await runAdPipeline(storyId)
  } else if (jobType === 'draft') {
    const { runMascotDraft } = await import('./draft-runner')
    await runMascotDraft(storyId)
  } else {
    const { runPipeline } = await import('./runner')
    await runPipeline(storyId, params.categoryId, params.credentialId)
  }
}

/**
 * Entry point the API routes call. In worker mode → enqueue (fast, returns immediately).
 * Otherwise → fire the pipeline inline (fire-and-forget) so local/dev still works unchanged.
 */
export async function runOrEnqueue(storyId: string, jobType: JobType, params: JobParams = {}): Promise<void> {
  if (workerMode()) { await enqueueJob(storyId, jobType, params); return }
  dispatchJob(storyId, jobType, params).catch(e =>
    console.error(`[queue] inline ${jobType} ${storyId} failed:`, e instanceof Error ? e.message : e))
}

export interface ClaimedJob { story_id: string; job_type: JobType; params: JobParams }

/**
 * Atomically claim the oldest queued job (FOR UPDATE SKIP LOCKED → safe with >1 worker).
 * Sets status='claimed'; the runner then advances it to its own steps.
 */
export async function claimNextJob(): Promise<ClaimedJob | null> {
  const [row] = await sql<{ story_id: string; job_type: string; operation_ids: { jobParams?: JobParams } | null }[]>`
    UPDATE pipeline_runs SET status = 'claimed', updated_at = NOW()
    WHERE story_id = (
      SELECT story_id FROM pipeline_runs
      WHERE status = 'queued'
      ORDER BY created_at
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING story_id, job_type, operation_ids`
  if (!row) return null
  return { story_id: row.story_id, job_type: (row.job_type || 'ad') as JobType, params: row.operation_ids?.jobParams || {} }
}

/**
 * Recover jobs a worker claimed but never started (process died right after claim). We only
 * requeue rows still at 'claimed' (never advanced to a real step) older than `olderThanMin`,
 * so we never re-run a job that was mid-generation (avoids double-spending Veo).
 */
export async function requeueStale(olderThanMin = 5): Promise<number> {
  const rows = await sql`
    UPDATE pipeline_runs SET status = 'queued', updated_at = NOW()
    WHERE status = 'claimed' AND updated_at < NOW() - ${`${olderThanMin} minutes`}::interval
    RETURNING story_id`
  return rows.length
}
