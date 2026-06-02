import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Each chunk is 8MB — safely under Next.js 10MB body limit
// Browser splits file, sends one chunk at a time

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)

// POST: upload one chunk
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params
  const chunkIndex = parseInt(req.headers.get('x-chunk-index') || '0')
  const totalChunks = parseInt(req.headers.get('x-total-chunks') || '1')

  if (!req.body) return NextResponse.json({ error: 'No body' }, { status: 400 })

  try {
    const chunkPath = `stories/${storyId}/.chunks/chunk_${String(chunkIndex).padStart(4, '0')}.part`
    const { Readable } = await import('stream')
    const { pipeline } = await import('stream/promises')

    const writeStream = bucket.file(chunkPath).createWriteStream({
      resumable: false,
      contentType: 'application/octet-stream',
    })

    await pipeline(
      Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
      writeStream
    )

    // If last chunk, compose all chunks into final file
    if (chunkIndex === totalChunks - 1) {
      const chunkFiles = Array.from({ length: totalChunks }, (_, i) =>
        bucket.file(`stories/${storyId}/.chunks/chunk_${String(i).padStart(4, '0')}.part`)
      )
      const finalFile = bucket.file(`stories/${storyId}/final/reel.mp4`)
      await bucket.combine(chunkFiles, finalFile)

      // Clean up chunks
      await Promise.all(chunkFiles.map(f => f.delete().catch(() => {})))

      // Update DB
      await storiesDb.update(storyId, { status: 'post_produced' })

      return NextResponse.json({ success: true, done: true })
    }

    return NextResponse.json({ success: true, done: false, chunkIndex })
  } catch (e: unknown) {
    console.error('Chunk upload error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Chunk upload failed' }, { status: 500 })
  }
}

// DELETE: clean up any leftover chunks (optional)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params
  try {
    const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/.chunks/` })
    await Promise.all(files.map(f => f.delete()))
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ success: true }) }
}
