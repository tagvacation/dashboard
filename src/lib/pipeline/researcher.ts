/**
 * The RESEARCHER — the input-side twin of the visual critic.
 *
 * Before we spend on generation, it (1) RESEARCHES what makes a short-form ad in this product's
 * category actually engaging (Google-Search-grounded), then (2) synthesizes an engagement-optimized
 * creative brief (a strong hook + the proven concept schema). Graceful: if grounding isn't
 * available it still produces an engagement-focused brief, just ungrounded.
 *
 * Output is a superset of the topic-picker concept, so the existing script-writer consumes it as-is.
 */
import { getAccessToken } from './auth'
import type { GcpContext } from './auth'
import { fetchWithRetry } from './fetch-retry'

const MODEL = 'gemini-2.5-flash'

/** Gemini with Google Search grounding (returns text — JSON mode can't be combined with search). */
async function researchGrounded(system: string, user: string, ctx: GcpContext): Promise<string> {
  const token = await getAccessToken(ctx)
  const url = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${MODEL}:generateContent`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
    }),
  }, { label: 'researcher-grounded', timeoutMs: 120_000 })
  if (!res.ok) throw new Error(`grounded ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  const parts = data.candidates?.[0]?.content?.parts || []
  return parts.map((p: { text?: string }) => p.text).filter(Boolean).join('\n').trim()
}

const RESEARCH_SYS = `You are a performance ad strategist for short-form video (Reels/Shorts/TikTok). Using web search, research what makes ads in THIS product's category actually engaging and high-converting. Be specific to the product.

Return CONCISE bullet findings:
- HOOK: 3 distinct scroll-stopping opening ideas (what happens in the first 1.5 seconds).
- LEAD BENEFIT: the single most compelling benefit/claim to build the ad around.
- PRODUCT FACTS: real key ingredients/actives/claims worth showing (only if confident).
- STRUCTURE: 2 ad structures that work for this category (beyond the generic "villain fight").
- PITFALLS: what makes such ads boring/skippable.
Keep it tight and actionable — this feeds an ad brief.`

const BRIEF_SYS = `You are a world-class creative director. Produce an ENGAGEMENT-OPTIMIZED brief for a premium mascot-style short ad (the product personified as a cute OBJECT-WITH-A-FACE character — like M&M's / Cup Noodles — NEVER a humanoid). Use the research findings to make it specific and scroll-stopping.

The #1 goal is ENGAGEMENT: a killer hook in the first 1.5s, a tight emotional arc, a clear payoff, and a memorable line. Avoid the generic "villain appears → mascot defends → wins" unless it's genuinely fresh.

Return ONLY JSON (this exact shape):
{
  "hook": "the specific scroll-stopping first-1.5s moment",
  "ad_concept": "1-2 line Hindi/Hinglish description of the story",
  "mascot_personality": "2-4 words",
  "voice_persona": "ONE consistent voice: gender + age + energy",
  "mascot_image_prompt": "ENGLISH: the product as a cute OBJECT-WITH-A-FACE mascot (keep its real shape/colours/label; a face + tiny stub arms; NOT a humanoid, no body/legs), in the vivid world, 9:16. 50-80 words.",
  "villain_description_en": "30-50 words, ONLY if the chosen structure needs an antagonist; else empty string",
  "world_description_en": "30-50 words: a vivid, RELEVANT, cinematic setting (never a plain studio)",
  "tagline_hinglish": "punchy 4-8 word Hinglish catchphrase",
  "headline_en": "end-card headline (ENGLISH, 3-6 words)",
  "cta_en": "end-card CTA (ENGLISH, 2-3 words)",
  "engagement_notes": "1-2 lines: how pacing + payoff keep it watch-to-the-end",
  "title_draft": "Hindi/Hinglish upload title with 1-2 emojis"
}`

export interface ResearchedBrief extends Record<string, unknown> {
  hook?: string; engagement_notes?: string
}

/** Research the product + category, then synthesize an engagement-optimized brief. */
export async function researchBrief(
  product: Record<string, unknown>, ctx: GcpContext, image?: { data: string; mimeType: string },
): Promise<ResearchedBrief> {
  let findings = ''
  try {
    findings = await researchGrounded(RESEARCH_SYS, `Product:\n${JSON.stringify(product, null, 2)}`, ctx)
  } catch { /* grounding unavailable → still produce an engagement-focused brief */ }

  const { callGemini } = await import('./ad-runner')
  const brief = await callGemini(
    BRIEF_SYS,
    `Product:\n${JSON.stringify(product, null, 2)}\n\nResearch findings (use these to make it specific + engaging):\n${findings || '(no external research available — rely on best practices)'}\n\nReturn the brief JSON only.`,
    ctx, 0.85, image,
  )
  return brief as ResearchedBrief
}
