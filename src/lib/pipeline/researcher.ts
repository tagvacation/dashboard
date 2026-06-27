/**
 * The RESEARCHER — the input-side twin of the visual critic.
 *
 * Before we spend on generation, it (1) RESEARCHES what makes a short-form ad in this product's
 * category actually engaging (Google-Search-grounded), then (2) synthesizes an engagement-optimized
 * creative brief. CRITICAL: it picks ONE ad ARCHETYPE (format) that fits the product AND differs
 * from recently-used ones — so the system stops emitting the same "mascot fights a villain" video
 * every time. Graceful: if grounding isn't available it still produces a brief, just ungrounded.
 *
 * Output is a superset of the topic-picker concept, so the existing script-writer consumes it as-is.
 */
import { getAccessToken } from './auth'
import type { GcpContext } from './auth'
import { fetchWithRetry } from './fetch-retry'

const MODEL = 'gemini-2.5-flash'

/**
 * The palette of distinct short-ad FORMATS. The product is always the same lovable
 * object-with-a-face mascot in ONE world — but the STORY, world and energy change per archetype.
 * Only `hero_vs_villain` uses a villain; the rest get their drama elsewhere (this is the fix for
 * "every ad is a villain fight in a sparkly garden").
 */
const ARCHETYPES = `1. hero_vs_villain — a playful antagonist (the problem, personified) threatens; the mascot clashes and wins. Beats: hook_threat, clash, turning_point, victory. Energy: high action. Villain: YES.
2. transformation — a dull/problem world turns radiant after the product moment (the "problem" is an ambient state, NOT a character). Beats: dull_world, product_moment, transformation, radiant_reveal. Energy: premium, satisfying. Villain: no.
3. asmr_satisfying — oddly-satisfying sensory close-ups (pumps, swirls, droplets, ribbons, textures), calm and luxurious. Beats: tease, satisfying_action, macro_payoff, glow. Energy: calm, tactile. Villain: no.
4. day_in_life — the mascot lives a relatable little day; the product saves ONE key moment. Beats: morning, little_mishap, product_save, happy_win. Energy: warm, charming. Villain: no.
5. world_adventure — the mascot journeys through a vivid world tied to the benefit (beach, monsoon, snowy peak, neon city, space). Beats: set_off, journey, benefit_payoff, arrive_glow. Energy: fun, adventurous. Villain: no.
6. hype_testimonial — the mascot talks straight to camera, high-energy, hypes the #1 benefit and names its key ingredient. Beats: bold_claim, proof, ingredient_flex, cta. Energy: confident, punchy. Villain: no.
7. comparison_playful — lighthearted "the ordinary way vs THIS" (a dull ordinary version beside the glowing mascot). Beats: ordinary, the_switch, glow_difference, cta. Energy: cheeky, light. Villain: no.
8. mini_musical — an upbeat rhythmic montage; the mascot grooves through the benefit beats. Beats: beat_drop, groove, highlights, finale. Energy: colourful, musical. Villain: no.`

/** Gemini with Google Search grounding (returns text — JSON mode can't be combined with search). */
async function researchGrounded(system: string, user: string, ctx: GcpContext): Promise<string> {
  // Prefer the free GEMINI_API_KEY (no Vertex credits); fall back to Vertex if no key.
  const { hasGeminiApiKey, geminiApiGenerate } = await import('./gemini-api')
  if (hasGeminiApiKey()) {
    return geminiApiGenerate({ system, parts: [{ text: user }], temperature: 0.6, grounding: true, maxOutputTokens: 2048 })
  }
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

/** The last few ad archetypes actually used, so the brief can avoid repeating them. */
async function recentArchetypes(): Promise<string[]> {
  try {
    const { sql } = await import('../db')
    const rows = await sql<{ a: string | null }[]>`
      SELECT operation_ids->'draftConcept'->>'ad_archetype' AS a
      FROM pipeline_runs
      WHERE operation_ids->'draftConcept'->>'ad_archetype' IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 4`
    return [...new Set(rows.map(r => r.a).filter((x): x is string => !!x))]
  } catch { return [] }
}

const RESEARCH_SYS = `You are a performance ad strategist for short-form video (Reels/Shorts/TikTok). Using web search, research what makes ads in THIS product's category actually engaging and high-converting. Be specific to the product.

Return CONCISE bullet findings:
- HOOK: 3 distinct scroll-stopping opening ideas (what happens in the first 1.5 seconds).
- LEAD BENEFIT: the single most compelling benefit/claim to build the ad around.
- PRODUCT FACTS: real key ingredients/actives/claims worth showing (only if confident).
- FORMATS: 2-3 different ad FORMATS that suit this product (e.g. transformation, ASMR/satisfying, day-in-life, testimonial, comparison) — NOT only the generic "villain fight".
- PITFALLS: what makes such ads boring/skippable.
Keep it tight and actionable — this feeds an ad brief.`

const BRIEF_SYS = `You are a world-class creative director. Build an ENGAGEMENT-OPTIMIZED brief for a premium short ad where the product is personified as a cute OBJECT-WITH-A-FACE mascot (like M&M's / Cup Noodles — NEVER a humanoid; keep its real shape/colours/label). The mascot, voice and world stay consistent within the ad.

═══ PICK AN ARCHETYPE (this is what creates VARIETY) ═══
Choose the ONE ad archetype below that genuinely best fits THIS product. Then build the whole brief around it.
RULES:
- DO NOT default to hero_vs_villain. Most products are better served by transformation, asmr_satisfying, day_in_life, world_adventure, hype_testimonial, comparison_playful, or mini_musical.
- You MUST NOT pick any archetype listed in "recently used" — choose a different one for freshness.
- VARY THE WORLD to match the archetype + benefit (e.g. a sunlit beach for "summer breeze", a steamy bathroom for a face wash, a neon kitchen) — never default to a generic sparkly garden.

ARCHETYPES:
${ARCHETYPES}

The #1 goal is ENGAGEMENT: a killer hook in the first 1.5s, a tight arc that matches the archetype, a clear payoff, and a memorable line.

Return ONLY JSON (this exact shape):
{
  "ad_archetype": "exactly one id from the menu, and NOT one in 'recently used'",
  "structure": ["the ordered beat ids for the chosen archetype, e.g. dull_world, product_moment, transformation, radiant_reveal"],
  "hook": "the specific scroll-stopping first-1.5s moment",
  "ad_concept": "1-2 line Hindi/Hinglish description of the story (matching the archetype)",
  "mascot_personality": "2-4 words",
  "voice_persona": "ONE consistent voice: gender + age + energy",
  "mascot_image_prompt": "ENGLISH: the product as a cute OBJECT-WITH-A-FACE mascot (keep its real shape/colours/label; a face + tiny stub arms; NOT a humanoid, no body/legs), in the vivid world, 9:16. 50-80 words.",
  "villain_description_en": "30-50 words ONLY if ad_archetype is hero_vs_villain; otherwise an EMPTY string",
  "world_description_en": "30-50 words: a vivid, RELEVANT, cinematic setting that matches the archetype + benefit (never a plain studio, never a default sparkly garden)",
  "tagline_hinglish": "punchy 4-8 word Hinglish catchphrase",
  "headline_en": "end-card headline (ENGLISH, 3-6 words)",
  "cta_en": "end-card CTA (ENGLISH, 2-3 words)",
  "engagement_notes": "1-2 lines: how the archetype's pacing + payoff keep it watch-to-the-end",
  "title_draft": "Hindi/Hinglish upload title with 1-2 emojis"
}`

export interface ResearchedBrief extends Record<string, unknown> {
  hook?: string; engagement_notes?: string; ad_archetype?: string
}

/** Research the product + category, then synthesize an engagement-optimized, NON-repeating brief. */
export async function researchBrief(
  product: Record<string, unknown>, ctx: GcpContext, image?: { data: string; mimeType: string },
): Promise<ResearchedBrief> {
  let findings = ''
  try {
    findings = await researchGrounded(RESEARCH_SYS, `Product:\n${JSON.stringify(product, null, 2)}`, ctx)
  } catch { /* grounding unavailable → still produce an engagement-focused brief */ }

  const recent = await recentArchetypes()

  const { callGemini } = await import('./ad-runner')
  const brief = await callGemini(
    BRIEF_SYS,
    `Product:\n${JSON.stringify(product, null, 2)}\n\n` +
    `Recently used archetypes (DO NOT pick any of these — choose a different one): ${recent.length ? recent.join(', ') : '(none yet)'}\n\n` +
    `Research findings (use these to make it specific + engaging):\n${findings || '(no external research available — rely on best practices)'}\n\n` +
    `Return the brief JSON only.`,
    ctx, 0.9, image,
  )
  return brief as ResearchedBrief
}
