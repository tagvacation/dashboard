import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'
import { requireUserId } from '@/lib/auth-server'
import crypto from 'crypto'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucketName = process.env.GCS_BUCKET!
const bucket = storage.bucket(bucketName)

/**
 * POST /api/ads/upload-image
 * Body: FormData with 'image' file
 * Returns: { gcsUri, publicUrl }
 *
 * Image goes to gs://bucket/users/{user_id}/ad-refs/{hash}.{ext}
 */
export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  try {
    const form = await req.formData()
    const file = form.get('image') as File | null
    if (!file) return NextResponse.json({ error: 'No image file' }, { status: 400 })
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Not an image' }, { status: 400 })
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Image too large (max 8MB)' }, { status: 400 })

    let buf = Buffer.from(await file.arrayBuffer())
    let mimeType = file.type
    let ext = file.type === 'image/jpeg' ? 'jpg' : 'png'

    // Veo only accepts JPEG / PNG. Convert WebP (and anything else) to PNG.
    if (file.type === 'image/webp' || (file.type !== 'image/jpeg' && file.type !== 'image/png')) {
      const converted = await sharp(buf).png({ quality: 95 }).toBuffer()
      buf = Buffer.from(converted)
      mimeType = 'image/png'
      ext = 'png'
    }

    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const path = `users/${userId}/ad-refs/${hash}.${ext}`

    await bucket.file(path).save(buf, { contentType: mimeType, resumable: false })

    // Background-removed transparent cutout for the hybrid ad compositor.
    // Non-fatal: if removal fails, the pipeline still runs (just without product overlay).
    let cutoutGcsUri: string | null = null
    let cutoutPublicUrl: string | null = null
    try {
      const { removeBackground } = await import('@imgly/background-removal-node')
      // Wrap in a typed Blob — the lib can't sniff the mime from a raw Buffer.
      const blob = await removeBackground(new Blob([new Uint8Array(buf)], { type: mimeType }))
      const cutoutBuf = Buffer.from(await blob.arrayBuffer())
      const cutoutPath = `users/${userId}/ad-refs/${hash}_cutout.png`
      await bucket.file(cutoutPath).save(cutoutBuf, { contentType: 'image/png', resumable: false })
      cutoutGcsUri = `gs://${bucketName}/${cutoutPath}`
      cutoutPublicUrl = `https://storage.googleapis.com/${bucketName}/${cutoutPath}`
    } catch (bgErr) {
      console.error('Background removal failed (continuing without cutout):', bgErr)
    }

    return NextResponse.json({
      gcsUri: `gs://${bucketName}/${path}`,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${path}`,
      cutoutGcsUri,
      cutoutPublicUrl,
    })
  } catch (e) {
    console.error('Image upload error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed' }, { status: 500 })
  }
}
