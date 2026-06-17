import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { storiesDb } from '@/lib/db'
import { contextForStory, bucketForContext } from '@/lib/gcs'
import { spawn } from 'child_process'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    p.stderr?.on('data', d => { err += d.toString() })
    p.on('error', reject)
    p.on('close', c => c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-300)}`)))
  })
}

/**
 * POST /api/stories/{id}/reduce — (re)build the small web/slider version (~5MB, 540p,
 * muted) from the master reel. For prebuilt videos that have no preview, or to refresh it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params
  // Adjustable output size: width (px) + crf (quality). Defaults ≈540p / ~5MB.
  const body = await req.json().catch(() => ({}))
  const width = Math.max(360, Math.min(1080, parseInt(body.width) || 540))
  const crf = Math.max(20, Math.min(36, parseInt(body.crf) || 30))

  const row = await storiesDb.get(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((row as { user_id?: string }).user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const ctx = await contextForStory(id)
    const { bucket } = bucketForContext(ctx)
    const masterPath = `stories/${id}/final/reel.mp4`
    const [exists] = await bucket.file(masterPath).exists()
    if (!exists) return NextResponse.json({ error: 'No final reel to reduce' }, { status: 404 })

    const work = join(tmpdir(), `reduce-${id}-${Date.now()}`)
    await mkdir(work, { recursive: true })
    try {
      const master = join(work, 'master.mp4')
      await writeFile(master, (await bucket.file(masterPath).download())[0])
      const out = join(work, 'web.mp4')
      // Keep audio (aac); only the slider mutes via the <video> attribute.
      await runFfmpeg(['-y', '-i', master, '-vf', `scale=${width}:-2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
      const buf = await readFile(out)
      // Short cache so re-encodes (e.g. switching 540p→720p) show immediately.
      await bucket.file(`stories/${id}/final/reel_preview.mp4`).save(buf, {
        contentType: 'video/mp4', resumable: false, metadata: { cacheControl: 'public, max-age=60' },
      })
      return NextResponse.json({
        success: true,
        size_mb: +(buf.length / 1024 / 1024).toFixed(1),
        // cache-busted so the UI shows the new encode right away
        url: `https://storage.googleapis.com/${ctx.bucket}/stories/${id}/final/reel_preview.mp4?v=${Date.now()}`,
      })
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {})
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Reduce failed' }, { status: 500 })
  }
}
