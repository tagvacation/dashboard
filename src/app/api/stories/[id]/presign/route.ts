import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'

export const dynamic = 'force-dynamic'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)

// GET /api/stories/{id}/presign → returns a signed GCS upload URL
// Browser uploads directly to GCS (bypasses Next.js body limit entirely)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params
  const gcsPath = `stories/${storyId}/final/reel.mp4`

  try {
    const [signedUrl] = await bucket.file(gcsPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType: 'video/mp4',
    })

    return NextResponse.json({ signedUrl, gcsPath })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create upload URL' }, { status: 500 })
  }
}

// POST /api/stories/{id}/presign → confirm upload complete, update DB
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params
  const gcsPath = `stories/${storyId}/final/reel.mp4`

  try {
    // Verify the file actually exists in GCS
    const [exists] = await bucket.file(gcsPath).exists()
    if (!exists) {
      return NextResponse.json({ error: 'File not found in GCS — upload may have failed' }, { status: 400 })
    }

    const { storiesDb } = await import('@/lib/db')
    await storiesDb.update(storyId, { status: 'post_produced' })

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
