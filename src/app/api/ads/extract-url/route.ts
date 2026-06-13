import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'
import crypto from 'crypto'
import sharp from 'sharp'
import { requireUserId } from '@/lib/auth-server'
import { defaultContext } from '@/lib/pipeline/auth'
import { callGemini } from '@/lib/pipeline/ad-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CATEGORIES = ['Haircare', 'Skincare', 'Food / Snack', 'Beverage', 'Jewelry', 'Fashion', 'Electronics', 'Home / Kitchen', 'Health / Wellness', 'Other']

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const bucketName = process.env.GCS_BUCKET!
const bucket = new Storage({ credentials }).bucket(bucketName)

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * POST /api/ads/extract-url  { url }
 * Auto-extracts product details for the Ads form:
 *  - Shopify stores → deterministic /products/<handle>.json (title, price, image, description)
 *  - any site → fetch HTML, let Gemini extract
 * Then Gemini structures name/category/benefits/audience, and we bg-remove the product image.
 */
export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  try {
    const { url } = await req.json()
    if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: 'Enter a valid product URL' }, { status: 400 })

    const clean = url.split('?')[0].replace(/\/$/, '')
    let title = '', description = '', priceNum: number | undefined, imageUrl = '', vendor = '', productType = ''

    // 1. Shopify deterministic path
    try {
      const r = await fetch(`${clean}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (r.ok) {
        const p = (await r.json()).product
        if (p) {
          title = p.title || ''
          description = stripHtml(p.body_html || '').slice(0, 1500)
          vendor = p.vendor || ''
          productType = p.product_type || ''
          priceNum = p.variants?.[0]?.price ? Math.round(parseFloat(p.variants[0].price)) : undefined
          imageUrl = p.images?.[0]?.src || ''
        }
      }
    } catch { /* not shopify */ }

    // 2. Generic fallback: scrape HTML
    if (!title) {
      const html = await (await fetch(clean, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()
      title = (html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || html.match(/<title>([^<]+)<\/title>/)?.[1] || '').trim()
      description = stripHtml(html.match(/<meta name="description" content="([^"]+)"/)?.[1] || '').slice(0, 1500)
      imageUrl = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || ''
      const pm = html.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/)
      if (pm) priceNum = Math.round(parseFloat(pm[1]))
    }

    if (!title) return NextResponse.json({ error: 'Could not read this product page' }, { status: 422 })

    // 3. Gemini structures the marketing fields
    const ctx = defaultContext()
    let structured: Record<string, unknown> = {}
    try {
      structured = await callGemini(
        `You extract structured product-ad fields. Return STRICT JSON: { "name": string, "category": one of ${JSON.stringify(CATEGORIES)}, "benefits": string[3-5 short benefit/claim bullets], "target_audience": short phrase }. Pick the closest category.`,
        `Product title: ${title}\nVendor: ${vendor}\nType: ${productType}\nDescription: ${description}\n\nReturn JSON only.`,
        ctx, 0.4,
      )
    } catch { /* fall back to raw below */ }

    const category = CATEGORIES.includes(structured.category as string) ? structured.category : 'Other'
    const benefits = Array.isArray(structured.benefits) && structured.benefits.length ? structured.benefits : (description ? [description.slice(0, 120)] : [])

    // 4. Download + bg-remove the product image → GCS
    let imageGcsUri: string | null = null, cutoutGcsUri: string | null = null, imagePublicUrl: string | null = null
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        const orig = Buffer.from(await imgRes.arrayBuffer())
        const buf = await sharp(orig).png({ quality: 95 }).toBuffer()
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
        const path = `users/${userId}/ad-refs/${hash}.png`
        await bucket.file(path).save(buf, { contentType: 'image/png', resumable: false })
        imageGcsUri = `gs://${bucketName}/${path}`
        imagePublicUrl = `https://storage.googleapis.com/${bucketName}/${path}`
        try {
          const { removeBackground } = await import('@imgly/background-removal-node')
          const blob = await removeBackground(new Blob([new Uint8Array(buf)], { type: 'image/png' }))
          const cut = Buffer.from(await blob.arrayBuffer())
          const cutPath = `users/${userId}/ad-refs/${hash}_cutout.png`
          await bucket.file(cutPath).save(cut, { contentType: 'image/png', resumable: false })
          cutoutGcsUri = `gs://${bucketName}/${cutPath}`
        } catch (e) { console.error('bg-removal failed:', e) }
      } catch (e) { console.error('product image fetch failed:', e) }
    }

    return NextResponse.json({
      name: (structured.name as string) || title,
      category,
      price: priceNum,
      benefits,
      target_audience: (structured.target_audience as string) || '',
      imageGcsUri, cutoutGcsUri, imagePublicUrl,
    })
  } catch (e) {
    console.error('extract-url error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Extraction failed' }, { status: 500 })
  }
}
