import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'

export const dynamic = 'force-dynamic'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params
  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'No path param' }, { status: 400 })

  try {
    await bucket.file(path).delete()

    // Return remaining clips so UI updates without full reload
    const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/clips/` })
    const remaining = files
      .filter(f => f.name.endsWith('.mp4'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => ({ name: f.name, url: `${PUBLIC_BASE}/${f.name}`, size: parseInt(f.metadata.size as string) || 0 }))

    return NextResponse.json({ success: true, remainingClips: remaining })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Delete failed' }, { status: 500 })
  }
}
