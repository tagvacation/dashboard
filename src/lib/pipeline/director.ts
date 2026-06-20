/**
 * AI Creative Director — the "brain" that makes the creative calls a merchant can't.
 *
 * Given the product (details + real image), it DECIDES the ad format, the ideal voice, and
 * the background-music mood — so the merchant just supplies a product and gets a tailored ad.
 * Runs once at the top of the ad pipeline when the merchant chose "Smart / AI decides".
 */
import type { GcpContext } from './auth'

export type AdFormat = 'mascot' | 'model' | 'broll' | 'emotional'
export type MusicMood = 'epic' | 'upbeat' | 'warm' | 'calm'

export interface DirectorProduct {
  name: string; category: string; benefits?: string[]; ingredients?: string | null
  target_audience?: string; price?: number
}

export interface CreativeBrief {
  ad_format: AdFormat
  voice: string        // "gender + age + energy" persona, or '' for silent formats (model/broll)
  music_mood: MusicMood
  audience: string
  rationale: string
}

const DIRECTOR_SYS = `You are a world-class short-form video ADVERTISING CREATIVE DIRECTOR. The merchant is NOT an ad expert — you make ALL the creative calls from the product (details + image).

DECIDE:
1) ad_format — exactly one:
   • "model"     — a real human model wearing/using it. BEST for anything WORN: fashion, apparel, kurta/saree, jewelry, eyewear, watches, bags, footwear.
   • "broll"     — cinematic atmosphere/ingredient/texture footage, no people. BEST for perfume, fragrance, beverages, food, candles, tea/coffee — sensory/premium products with no "problem" to fight.
   • "mascot"    — the product personified as a cute character that defeats its problem. BEST for skincare/haircare/health/personal-care with a clear problem→benefit (acne, tan, hairfall, dullness) and a fun, mass-appeal vibe.
   • "emotional" — lifestyle footage with the real product + a warm voiceover. A safe general default when none of the above clearly fit.
2) voice — the ideal narrator/character voice as "gender + age + energy" (e.g. "warm confident female, late 20s"). Derive from the audience: women's product → female; men's → male; kids → cheerful child-like; family/general → warm mature narrator. For SILENT formats (model, broll) return "".
3) music_mood — exactly one of: epic | upbeat | warm | calm. Fit the product + audience.
4) audience — a refined one-line target audience (infer if the input is vague).
5) rationale — ONE short sentence on why this format + voice fit THIS product.

Return ONLY JSON: { "ad_format", "voice", "music_mood", "audience", "rationale" }. No prose.`

const FORMATS: AdFormat[] = ['mascot', 'model', 'broll', 'emotional']
const MOODS: MusicMood[] = ['epic', 'upbeat', 'warm', 'calm']

export async function runDirector(
  product: DirectorProduct, ctx: GcpContext, image?: { data: string; mimeType: string },
): Promise<CreativeBrief> {
  const { callGemini } = await import('./ad-runner')   // dynamic import avoids a static import cycle
  const out = await callGemini(
    DIRECTOR_SYS,
    `Product:\n${JSON.stringify(product, null, 2)}\n\nThe attached image (if any) is the REAL product. Decide the brief. Return JSON only.`,
    ctx, 0.5, image,
  ).catch(() => ({} as Record<string, unknown>))

  const ad_format = FORMATS.includes(out.ad_format as AdFormat) ? out.ad_format as AdFormat : 'emotional'
  const music_mood = MOODS.includes(out.music_mood as MusicMood) ? out.music_mood as MusicMood : 'warm'
  // model & broll are silent — never carry a voice.
  const silent = ad_format === 'model' || ad_format === 'broll'
  const voice = silent ? '' : (typeof out.voice === 'string' ? out.voice : '')
  return {
    ad_format, music_mood, voice,
    audience: (typeof out.audience === 'string' && out.audience) || product.target_audience || '',
    rationale: typeof out.rationale === 'string' ? out.rationale : '',
  }
}
