import { NextRequest, NextResponse } from 'next/server'
import { getUserGcpContext, getAccessToken } from '@/lib/pipeline/auth'
import type { GcpContext } from '@/lib/pipeline/auth'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const GEMINI_MODEL = 'gemini-2.5-flash'

function geminiUrl(ctx: GcpContext): string {
  return `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${GEMINI_MODEL}:generateContent`
}

export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  let ctx: GcpContext
  try { ctx = await getUserGcpContext(userId) } catch { return NextResponse.json({ error: 'ADD_CLOUD_ACCOUNT' }, { status: 400 }) }

  const { prompt, primary_anchor, secondary_anchor, has_secondary, issue } = await req.json()
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  // ── Extract action part (strip anchors + style from both ends) ─────────────
  let action = String(prompt)

  const styleMarkers = [
    'Pixar-inspired', 'Warm glowing particle', 'Wide-angle cinematic lens',
    'No character voices', 'ambient sounds only', 'Vertical 9:16',
    'cinematic lens', 'Magical realism', 'Epic cinematic', 'Bright pop-art',
    'comic book style', 'animation quality',
  ]

  // Strip primary anchor
  const pa = String(primary_anchor || '')
  if (pa && action.startsWith(pa)) {
    action = action.slice(pa.length).trim()
  }
  // Strip wide two-shot + secondary anchor
  if (action.startsWith('Wide two-shot framing.')) {
    action = action.replace('Wide two-shot framing.', '').trim()
    const sa = String(secondary_anchor || '')
    if (sa && action.startsWith(sa)) {
      action = action.slice(sa.length).trim()
    }
  }
  // Strip style suffix
  for (const marker of styleMarkers) {
    const idx = action.indexOf(marker)
    if (idx !== -1) { action = action.slice(0, idx).trim(); break }
  }

  // Also strip Hindi text that may have leaked in
  action = action.replace(/[ऀ-ॿ਀-੿]+/g, '').trim()

  // ── Ask Gemini to fix ONLY the action (1-3 sentences) ─────────────────────
  const system = `You fix rejected Veo animation action descriptions to pass content filters.
Return ONLY 1-3 sentences describing a SAFE peaceful visual action.
Rules:
- Indian village or period setting
- No violence, death, distress, screaming, angry crowds, supernatural words
- Replace negative actions with: sitting quietly, looking into distance, hands clasped, gentle gestures
- Show the emotional moment visually (body language, environment) not through aggressive narrative
- Return ONLY the action sentences, nothing else — no character names, no style words`

  const user = `${issue ? `Filter error: ${issue}\n\n` : ''}Fix this rejected action description:
${action || '(empty — create a peaceful scene-appropriate action based on context)'}

Make it pass Veo content filters while keeping the scene visually meaningful.`

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  try {
    const fetchBody = JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
    })
    const doFetch = async () => {
      const token = await getAccessToken(ctx)
      return fetch(geminiUrl(ctx), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: fetchBody,
      })
    }
    let res = await doFetch()
    for (let attempt = 1; attempt < 4 && res.status === 429; attempt++) {
      const retryAfterSec = parseInt(res.headers.get('Retry-After') || '0')
      const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : Math.pow(2, attempt) * 5_000
      await sleep(waitMs)
      res = await doFetch()
    }
    if (!res.ok) throw new Error(`Gemini error ${res.status}`)
    const data = await res.json()
    const fixedAction = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!fixedAction) throw new Error('Empty response')

    // ── Programmatically reconstruct with original anchors ─────────────────
    const styleSuffix = 'Pixar-inspired stylized 3D animation, warm soft lighting, expressive character faces, vibrant colors, smooth animation quality, Indian period village setting. No character voices or dialogue audio — ambient environmental sounds only (wind, birds, rain, market crowd, temple bells, nature sounds matching the scene). Vertical 9:16, no text or captions in frame, no logos or brand marks.'

    let fixed = pa
    if (has_secondary && secondary_anchor) {
      fixed += ` Wide two-shot framing. ${secondary_anchor}`
    }
    fixed += ` ${fixedAction} ${styleSuffix}`

    return NextResponse.json({ fixed })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
