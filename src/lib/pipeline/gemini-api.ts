/**
 * Gemini via the free GEMINI_API_KEY (generativelanguage.googleapis.com) — NOT Vertex.
 *
 * The platform's CHEAP text/vision work (concept, script, research, URL-extract, prompt-fix,
 * visual critic) runs here so it never burns Vertex credits and works even before a user has
 * added their own Cloud account. The EXPENSIVE work (Veo video + Imagen/nano image gen) still
 * runs on the user's own account. Callers fall back to Vertex only if no key is set.
 */
import { fetchWithRetry } from './fetch-retry'

export const hasGeminiApiKey = (): boolean => !!process.env.GEMINI_API_KEY

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiPart { text?: string; inlineData?: { mimeType: string; data: string } }

/** One generateContent call via the API key. Supports system, image parts, JSON mode, grounding. */
export async function geminiApiGenerate(opts: {
  system?: string
  parts: GeminiPart[]
  model?: string
  temperature?: number
  json?: boolean
  grounding?: boolean
  maxOutputTokens?: number
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')
  const model = opts.model || 'gemini-2.5-flash'
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: opts.parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.85,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      // JSON mode can't combine with grounding (search) — skip responseMimeType when grounding.
      ...(opts.json && !opts.grounding ? { responseMimeType: 'application/json' } : {}),
    },
  }
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] }
  if (opts.grounding) body.tools = [{ google_search: {} }]
  const res = await fetchWithRetry(`${BASE}/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { label: 'gemini-api', timeoutMs: 120_000 })
  if (!res.ok) throw new Error(`gemini-api ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const parts = data.candidates?.[0]?.content?.parts || []
  return parts.map((p: { text?: string }) => p.text).filter(Boolean).join('\n').trim()
}

/** Parse JSON from a model response that may be wrapped in ``` fences or prose. */
export function parseJsonLoose(text: string): Record<string, unknown> {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  if (!t.startsWith('{') && !t.startsWith('[')) { const m = t.match(/[{[][\s\S]*[}\]]/); if (m) t = m[0] }
  return JSON.parse(t)
}
