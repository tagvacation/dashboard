import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { getUserGcpContext } from '@/lib/pipeline/auth'
import { callGemini } from '@/lib/pipeline/ad-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CATEGORIES = ['Haircare', 'Skincare', 'Food / Snack', 'Beverage', 'Jewelry', 'Fashion', 'Electronics', 'Home / Kitchen', 'Health / Wellness', 'Other']

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const normUrl = (u: string) => (u.startsWith('//') ? `https:${u}` : u)

/**
 * POST /api/ads/extract-url  { url }
 * Extracts product details + a list of CANDIDATE product images (the user picks the
 * right one in the form; the picked image is processed by /api/ads/import-image).
 *  - Shopify stores → /products/<handle>.json (all images, price, description)
 *  - any site → scrape og:image + <img> tags
 */
export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  try {
    const { url } = await req.json()
    if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: 'Enter a valid product URL' }, { status: 400 })

    // ctx is the user's own GCP project (used for Gemini structuring). No env default.
    let ctx
    try { ctx = await getUserGcpContext(userId) }
    catch { return NextResponse.json({ error: 'ADD_CLOUD_ACCOUNT' }, { status: 400 }) }

    const clean = url.split('?')[0].replace(/\/$/, '')
    let title = '', description = '', priceNum: number | undefined, vendor = '', productType = ''
    let images: string[] = []

    // 1. Shopify deterministic path — returns ALL product images
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
          images = (p.images || []).map((im: { src: string }) => im.src).filter(Boolean)
        }
      }
    } catch { /* not shopify */ }

    // 2. Generic fallback: scrape HTML (og:image + <img> srcs)
    if (!title) {
      const html = await (await fetch(clean, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()
      title = (html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || html.match(/<title>([^<]+)<\/title>/)?.[1] || '').trim()
      description = stripHtml(html.match(/<meta name="description" content="([^"]+)"/)?.[1] || '').slice(0, 1500)
      const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]
      const imgSrcs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1])
        .filter(s => /^https?:|^\/\//.test(s) && /\.(jpe?g|png|webp)/i.test(s))
      images = [...new Set([og, ...imgSrcs].filter(Boolean) as string[])].slice(0, 12)
      const pm = html.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/)
      if (pm) priceNum = Math.round(parseFloat(pm[1]))
    }

    if (!title) return NextResponse.json({ error: 'Could not read this product page' }, { status: 422 })
    images = [...new Set(images.map(normUrl))].slice(0, 12)

    // 3. Gemini structures the marketing fields (on the user's GCP project)
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

    return NextResponse.json({
      name: (structured.name as string) || title,
      category,
      price: priceNum,
      benefits,
      target_audience: (structured.target_audience as string) || '',
      images, // candidate image URLs — user picks one → /api/ads/import-image
    })
  } catch (e) {
    console.error('extract-url error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Extraction failed' }, { status: 500 })
  }
}
