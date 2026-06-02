import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — large video uploads need time

function isAuthorized(req: NextRequest): boolean {
  const token = req.cookies.get('auth_token')?.value
  const expected = Buffer.from(`${process.env.DASHBOARD_PASSWORD}:${process.env.JWT_SECRET}`).toString('base64')
  return token === expected
}

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: storyId } = await params

  try {
    const gcsPath = `stories/${storyId}/final/reel.mp4`
    const gcsFile = bucket.file(gcsPath)

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      // Fallback: FormData (small files only)
      const formData = await req.formData()
      const file = formData.get('file') as File
      if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
      const buffer = Buffer.from(await file.arrayBuffer())
      await gcsFile.save(buffer, { contentType: 'video/mp4', resumable: buffer.length > 5_000_000 })
    } else {
      // Raw binary stream — preferred for large files (frontend sends file directly as body)
      if (!req.body) return NextResponse.json({ error: 'No body' }, { status: 400 })
      const writeStream = gcsFile.createWriteStream({ resumable: true, contentType: 'video/mp4' })
      await pipeline(
        Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
        writeStream
      )
    }

    // Update status in PostgreSQL
    await storiesDb.update(storyId, { status: 'post_produced' })

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error('Upload error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
