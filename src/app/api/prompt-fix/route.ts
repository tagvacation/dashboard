import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

export async function POST(req: NextRequest) {
  const { prompt, primary_anchor, secondary_anchor, has_secondary, issue } = await req.json()
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 })

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

  try {
    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      }),
    })
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
