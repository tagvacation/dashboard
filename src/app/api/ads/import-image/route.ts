import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import sharp from 'sharp'
import { requireUserId } from '@/lib/auth-server'
import { getUserGcpContext } from '@/lib/pipeline/auth'
import { bucketForContext } from '@/lib/gcs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/ads/import-image  { imageUrl }
 * Downloads ONE picked product image (from the URL-extract candidates), normalizes it,
 * bg-removes it, and stores both in the user's own bucket.
 * Returns { imageGcsUri, cutoutGcsUri, imagePublicUrl }.
 */
export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  try {
    const { imageUrl } = await req.json()
    if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })

    let ctx
    try { ctx = await getUserGcpContext(userId) }
    catch { return NextResponse.json({ error: 'ADD_CLOUD_ACCOUNT' }, { status: 400 }) }
    const { bucket } = bucketForContext(ctx)
    const bucketName = ctx.bucket

    const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!imgRes.ok) return NextResponse.json({ error: 'Could not download that image' }, { status: 422 })
    const orig = Buffer.from(await imgRes.arrayBuffer())
    const buf = await sharp(orig).png({ quality: 95 }).toBuffer()
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

    const path = `users/${userId}/ad-refs/${hash}.png`
    await bucket.file(path).save(buf, { contentType: 'image/png', resumable: false })
    const imageGcsUri = `gs://${bucketName}/${path}`
    const imagePublicUrl = `https://storage.googleapis.com/${bucketName}/${path}`

    let cutoutGcsUri: string | null = null
    try {
      const { removeBackground } = await import('@imgly/background-removal-node')
      const blob = await removeBackground(new Blob([new Uint8Array(buf)], { type: 'image/png' }))
      const cut = Buffer.from(await blob.arrayBuffer())
      const cutPath = `users/${userId}/ad-refs/${hash}_cutout.png`
      await bucket.file(cutPath).save(cut, { contentType: 'image/png', resumable: false })
      cutoutGcsUri = `gs://${bucketName}/${cutPath}`
    } catch (e) { console.error('bg-removal failed:', e) }

    return NextResponse.json({ imageGcsUri, cutoutGcsUri, imagePublicUrl })
  } catch (e) {
    console.error('import-image error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed' }, { status: 500 })
  }
}
