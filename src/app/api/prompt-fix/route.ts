import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

export async function POST(req: NextRequest) {
  const { prompt, issue } = await req.json()
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 })

  const system = `You are an expert at fixing Veo (Google's AI video generator) prompts that were rejected by content filters.

VEO CONTENT FILTER RULES — what causes rejection:
- Violence words: hit, beat, strike, punch, fight, attack, grab, wound, blood, injury
- Death/distress: dead, dying, screaming, panicking, collapsing, suffering
- Negative emotions described as actions: grumbling angrily, threatening, confronting aggressively
- Social harm narratives: humiliation, izzat/honor lost, respect diminished
- Supernatural words: magic spell, supernatural power, curse (describe visually instead)
- Duplicate style suffixes, mixed styles

SAFE ALTERNATIVES:
- Violence → body language: "arms crossed firmly", "standing at distance", "turned away"
- Distress → subtle: "eyes glistening", "shoulders drooping", "quiet expression"
- Magic/supernatural → describe visually: "golden light radiating from", "floating gently"
- Negative narrative → neutral action: remove story context, just show visual pose/action

YOUR TASK:
Fix the given Veo prompt so it passes content filters while keeping the scene visually recognizable.
- Keep character anchor descriptions VERBATIM (the first long description)
- Keep the style suffix at end EXACTLY (Pixar-inspired... Vertical 9:16...)
- Only change the middle action/scene description
- Remove any duplicate style suffixes
- Return ONLY the fixed prompt text, nothing else`

  const user = `${issue ? `Issue reported: ${issue}\n\n` : ''}Fix this rejected Veo prompt:\n\n${prompt}`

  try {
    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
      }),
    })
    if (!res.ok) throw new Error(`Gemini error ${res.status}`)
    const data = await res.json()
    const fixed = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!fixed) throw new Error('Empty response')
    return NextResponse.json({ fixed })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
