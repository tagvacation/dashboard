import { NextRequest, NextResponse } from 'next/server'
import { sceneJobsDb, gcpCredentialsDb } from '@/lib/db'
import { submitVeoClip, pollVeoOperation } from '@/lib/pipeline/veo'
import { defaultContext } from '@/lib/pipeline/auth'
import type { GcpContext } from '@/lib/pipeline/auth'
import { Storage } from '@google-cloud/storage'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_BUCKET = process.env.GCS_BUCKET || 'ai_clip_007'
const PUBLIC_BASE = `https://storage.googleapis.com/${DEFAULT_BUCKET}`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function getContext(credentialId?: string): Promise<GcpContext> {
  if (!credentialId || credentialId === 'default') return defaultContext()
  const cred = await gcpCredentialsDb.get(credentialId)
  if (!cred) return defaultContext()
  return {
    credentials: JSON.parse(cred.sa_json),
    projectId: cred.project_id,
    bucket: DEFAULT_BUCKET,
    region: 'us-central1',
  }
}

// GET: list all scene jobs for a story
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const jobs = await sceneJobsDb.getByStory(id)
  return NextResponse.json({ scenes: jobs })
}

// POST: manually regenerate a specific failed/filtered scene
// Body: { scene_num: "03", video_prompt?: "custom override prompt" }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params
  const { scene_num, video_prompt: customPrompt, credential_id, model } = await req.json()
  const ctx = await getContext(credential_id)

  if (!scene_num) return NextResponse.json({ error: 'scene_num required' }, { status: 400 })

  // Get the latest job for this scene to inherit anchors/beat/tts
  const jobs = await sceneJobsDb.getByStory(storyId)
  const latestJob = jobs.filter(j => j.scene_num === scene_num).sort((a, b) => b.attempt - a.attempt)[0]

  if (!latestJob) return NextResponse.json({ error: `No scene job found for scene ${scene_num}` }, { status: 404 })

  const promptToUse = customPrompt || latestJob.video_prompt
  const nextAttempt = latestJob.attempt + 1

  try {
    // Create new attempt row
    await sceneJobsDb.create({
      story_id: storyId,
      scene_num,
      beat: latestJob.beat,
      video_prompt: promptToUse,
      tts_text: latestJob.tts_text,
      primary_anchor: latestJob.primary_anchor,
      secondary_anchor: latestJob.secondary_anchor,
      attempt: nextAttempt,
    })
    await sceneJobsDb.update(storyId, scene_num, nextAttempt, { status: 'submitted' })

    const opId = await submitVeoClip(promptToUse, ctx, model)
    await sceneJobsDb.update(storyId, scene_num, nextAttempt, { operation_id: opId, status: 'polling' })

    // Poll
    let base64 = ''
    for (let i = 0; i < 20; i++) {
      await sleep(60_000)
      const result = await pollVeoOperation(opId, ctx)
      if (!result.done) continue

      if (result.filtered) {
        await sceneJobsDb.update(storyId, scene_num, nextAttempt, {
          status: 'manual_pending',
          error_type: 'content_filter',
          error_message: result.error || 'Content filter',
        })
        return NextResponse.json({ error: 'Still filtered by Veo. Edit the prompt and try again.', scene_num }, { status: 422 })
      }

      base64 = result.base64 || ''
      break
    }

    if (!base64) {
      await sceneJobsDb.update(storyId, scene_num, nextAttempt, {
        status: 'manual_pending',
        error_type: 'timeout',
        error_message: 'Polling timeout',
      })
      return NextResponse.json({ error: 'Veo did not respond in time. Try again.' }, { status: 408 })
    }

    // Upload to GCS (always default bucket)
    const clipPath = `stories/${storyId}/clips/scene_${scene_num}.mp4`
    const buf = Buffer.from(base64, 'base64')
    const defaultCreds = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
    const { Storage: GCS } = await import('@google-cloud/storage')
    const gcsStorage = new GCS({ credentials: defaultCreds })
    await gcsStorage.bucket(DEFAULT_BUCKET).file(clipPath).save(buf, { contentType: 'video/mp4' })
    const clipUrl = `${PUBLIC_BASE}/${clipPath}`

    await sceneJobsDb.update(storyId, scene_num, nextAttempt, { status: 'done' })

    return NextResponse.json({ success: true, scene_num, clip_url: clipUrl })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    await sceneJobsDb.update(storyId, scene_num, nextAttempt, {
      status: 'manual_pending',
      error_type: 'api_error',
      error_message: msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
