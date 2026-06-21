/**
 * Multi-agent script critic loop. Runs AFTER Gemini writes a mascot script,
 * BEFORE Veo touches it. Four critics run in parallel, then a single revision
 * pass folds their notes back in.
 *
 * Each critic is a small focused Gemini call — cheap (one round-trip each).
 * Critics never modify the script; they only return structured issues.
 */
import type { GcpContext } from './auth'

// ─── Shared types ────────────────────────────────────────────────────────────
export type CriticName = 'diversity' | 'specificity' | 'composition' | 'coherence'
export type Severity = 'high' | 'medium' | 'low'

export interface CriticIssue {
  critic: CriticName
  severity: Severity
  scene?: number          // 1-based scene number, or undefined for whole-script issue
  issue: string           // what's wrong
  suggestion: string      // concrete fix
}

export interface CriticReport {
  critic: CriticName
  issues: CriticIssue[]
}

// ─── Hardcoded cliché bans (across ALL users) ────────────────────────────────
// Pulled from the actual repetition pattern observed across recent mascot ads:
// every script had garden/city/rooftop/cosmos settings + "barrier/aura/wave" verbs.
export const CLICHE_FORBIDDEN = {
  settings: [
    'withered garden', 'parched garden', 'botanical garden',
    'urban cityscape', 'concrete jungle', 'rooftop terrace', 'city rooftop',
    'cosmic background', 'starry sky', 'moonlit', 'lunar landscape',
    'desolate wasteland', 'crumbling ruins',
  ],
  verbs_and_phrases: [
    'energy wave', 'energy barrier', 'protective barrier', 'barrier wave',
    'deploys', 'unleashes', 'channels', 'gathers immense energy',
    'glowing aura', 'protective aura', 'encroaching darkness',
    'menacing approach', 'oppressive shadow',
    'desiccator', 'dehydration & damage', 'corruption',
  ],
  structures: [
    'villain enters → mascot defends → villain intensifies → mascot counters',
  ],
}

// ─── Recent-runs diversity registry ──────────────────────────────────────────
/**
 * Pull settings + mascot descriptions from this user's last `n` mascot runs so the
 * next run can be told "don't repeat these". Empty array if no past runs.
 */
export async function loadRecentForbidden(userId: string, limit = 5): Promise<{
  settings: string[]
  villains: string[]
  mascots: string[]
}> {
  const { sql } = await import('../db')
  const rows = await sql<{ script_json: string }[]>`
    SELECT pr.script_json FROM pipeline_runs pr
    JOIN stories s ON s.story_id = pr.story_id
    WHERE s.user_id = ${userId}
      AND s.category_id = 'ai_ad_mascot_drama'
      AND pr.script_json != ''
      AND pr.status = 'complete'
    ORDER BY pr.created_at DESC
    LIMIT ${limit}`

  const settings: string[] = []
  const villains: string[] = []
  const mascots: string[] = []

  for (const row of rows) {
    try {
      const j = JSON.parse(row.script_json)
      if (j.world_description_en) settings.push(String(j.world_description_en).slice(0, 200))
      if (j.villain_description_en) villains.push(String(j.villain_description_en).slice(0, 200))
      if (j.mascot_image_prompt) mascots.push(String(j.mascot_image_prompt).slice(0, 200))
    } catch { /* skip malformed */ }
  }
  return { settings, villains, mascots }
}

// ─── Critic factory ──────────────────────────────────────────────────────────
async function runCritic(
  name: CriticName,
  systemPrompt: string,
  userPrompt: string,
  ctx: GcpContext,
): Promise<CriticReport> {
  const { callGemini } = await import('./ad-runner')
  try {
    const out = await callGemini(systemPrompt, userPrompt, ctx, 0.3)
    const issues = Array.isArray(out.issues) ? out.issues as CriticIssue[] : []
    return { critic: name, issues: issues.map(i => ({ ...i, critic: name })) }
  } catch (e) {
    // A failed critic is not fatal — we just skip its notes
    console.warn(`[critic ${name}] failed: ${e instanceof Error ? e.message : e}`)
    return { critic: name, issues: [] }
  }
}

// ─── 1. DIVERSITY ────────────────────────────────────────────────────────────
const DIVERSITY_SYS = `You are a brand creative DIVERSITY CRITIC for short-form video ads. Your job is to flag CLICHÉS, REPETITION, and OVERUSED tropes that make every ad feel the same.

INPUT: a mascot ad script (4-8 scenes), plus a list of FORBIDDEN settings/verbs from past runs by this same merchant, plus globally-overused tropes.

FLAG (high severity):
- The script reuses a setting from the forbidden list
- The script reuses villain language from the forbidden list
- The script uses any banned cliché verb/phrase (barrier wave, aura, deploys, etc.)
- The 3-act structure is "villain enters → defends → intensifies → counters" (overused)

FLAG (medium severity):
- Generic visual language: "glowing aura", "powerful energy", "fierce battle" without specific product imagery
- A villain whose name is just a literal noun ("The Desiccator", "Dehydration") — too on-the-nose
- Scenes that all feel like the SAME beat

DON'T FLAG:
- Repeated PRODUCT references (the product is the hero; that's correct)
- Repeated style words about mascot appearance (continuity)

Return STRICT JSON:
{ "issues": [{ "severity": "high|medium|low", "scene": null|<num>, "issue": "...", "suggestion": "concrete alternative" }] }
Empty issues array = script is acceptable.`

export async function diversityCritic(
  script: Record<string, unknown>,
  forbidden: { settings: string[]; villains: string[]; mascots: string[] },
  ctx: GcpContext,
): Promise<CriticReport> {
  const userPrompt = `Script to review:
${JSON.stringify(script, null, 2)}

Forbidden settings (past 5 runs by this merchant — never reuse):
${forbidden.settings.length ? forbidden.settings.map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '  (none — first run)'}

Forbidden villain types:
${forbidden.villains.length ? forbidden.villains.map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '  (none)'}

Globally overused clichés to avoid:
- Settings: ${CLICHE_FORBIDDEN.settings.join(', ')}
- Verbs/phrases: ${CLICHE_FORBIDDEN.verbs_and_phrases.join(', ')}
- Structures: ${CLICHE_FORBIDDEN.structures.join(' | ')}

Return JSON.`
  return runCritic('diversity', DIVERSITY_SYS, userPrompt, ctx)
}

// ─── 2. SPECIFICITY ──────────────────────────────────────────────────────────
const SPECIFICITY_SYS = `You are a PRODUCT SPECIFICITY CRITIC. Your job is to flag scripts that could be for ANY product — they must be obviously, visibly THIS product.

INPUT: script + product details (name, category, benefits, ingredients).

FLAG (high severity):
- Mascot visuals don't reflect the product's actual colour, shape, packaging type
- Benefits are mentioned but NOT visually shown (e.g. says "hydration" but shows generic energy)
- Ingredients are listed in product but NEVER visualized in any scene
- Hero moment is generic ("powerful attack") — could swap to any product

FLAG (medium severity):
- Brand colours of the product not used as the dominant palette
- Scene actions could be done by any haircare/skincare bottle — not THIS specific one
- Tagline is generic ("the best!") rather than tied to a unique benefit

DON'T FLAG:
- Product description being verbose (consistency matters more than brevity)

Return STRICT JSON:
{ "issues": [{ "severity": "high|medium|low", "scene": null|<num>, "issue": "...", "suggestion": "concrete fix tied to product details" }] }`

export async function specificityCritic(
  script: Record<string, unknown>,
  product: Record<string, unknown>,
  ctx: GcpContext,
): Promise<CriticReport> {
  const userPrompt = `Script to review:
${JSON.stringify(script, null, 2)}

Product details:
${JSON.stringify(product, null, 2)}

Return JSON only.`
  return runCritic('specificity', SPECIFICITY_SYS, userPrompt, ctx)
}

// ─── 3. COMPOSITION ──────────────────────────────────────────────────────────
const COMPOSITION_SYS = `You are a VISUAL COMPOSITION CRITIC for 9:16 vertical short-form video. Your job is to ensure each scene FILLS THE FRAME and has dynamic, cinematic framing.

INPUT: script with per-scene video_prompts.

FLAG (high severity):
- Subject described as "centered" or "alone" with no foreground/background interest → empty 9:16 frame = cheap look
- Mascot described "full body" with no relative-size cue → likely renders SMALL in tall frame
- Static camera assumed across scenes (no zoom, no pan, no tilt, no rack-focus mentioned)
- Same framing repeated across consecutive scenes

FLAG (medium severity):
- Wide shot when a close-up would punch harder for emotion
- No depth cues (no foreground element, no background activity)

REQUIRED PER SCENE (suggest if missing):
- Explicit shot type: extreme close-up | close-up | medium close-up | medium | wide
- Camera angle: low-angle hero | high-angle | over-the-shoulder | dutch tilt | straight-on
- Camera movement: push-in | pull-out | pan | tilt | static | handheld
- Subject scale: "fills 70% of frame" or "occupies center third" — be explicit

Return STRICT JSON:
{ "issues": [{ "severity": "high|medium|low", "scene": <1-based>, "issue": "...", "suggestion": "explicit framing rewrite" }] }`

export async function compositionCritic(
  script: Record<string, unknown>,
  ctx: GcpContext,
): Promise<CriticReport> {
  const userPrompt = `Script to review:
${JSON.stringify(script, null, 2)}

For each scene, evaluate ONLY the framing/composition (not story). Return JSON.`
  return runCritic('composition', COMPOSITION_SYS, userPrompt, ctx)
}

// ─── 4. COHERENCE ────────────────────────────────────────────────────────────
const COHERENCE_SYS = `You are a STORY COHERENCE CRITIC for short ads (4-8 scenes, 30-60s total). Your job is to ensure the story actually escalates and resolves.

INPUT: script with scenes.

FLAG (high severity):
- World/setting changes between scenes without justification
- Mascot personality/voice shifts unexpectedly
- Scenes 2 and 3 (or 3 and 4) are functionally identical (same beat repeated)
- No clear resolution scene — ends mid-action
- The product/benefit is NEVER actually shown winning

FLAG (medium severity):
- Hindi narration (or dialogue) repeats the same emotional beat
- Tagline doesn't tie back to what was demonstrated in scenes
- Stakes don't escalate (scene 1's tension = scene 3's tension)

Return STRICT JSON:
{ "issues": [{ "severity": "high|medium|low", "scene": null|<num>, "issue": "...", "suggestion": "concrete fix" }] }`

export async function coherenceCritic(
  script: Record<string, unknown>,
  ctx: GcpContext,
): Promise<CriticReport> {
  const userPrompt = `Script to review:
${JSON.stringify(script, null, 2)}

Evaluate the story arc + consistency. Return JSON.`
  return runCritic('coherence', COHERENCE_SYS, userPrompt, ctx)
}

// ─── Run all in parallel + summarise ─────────────────────────────────────────
export interface CriticSummary {
  reports: CriticReport[]
  allIssues: CriticIssue[]
  hasBlockers: boolean   // any 'high' severity issue?
  notesForRevision: string  // formatted prompt-fragment to send back to Gemini
}

export async function runAllCritics(
  script: Record<string, unknown>,
  product: Record<string, unknown>,
  forbidden: { settings: string[]; villains: string[]; mascots: string[] },
  ctx: GcpContext,
): Promise<CriticSummary> {
  const reports = await Promise.all([
    diversityCritic(script, forbidden, ctx),
    specificityCritic(script, product, ctx),
    compositionCritic(script, ctx),
    coherenceCritic(script, ctx),
  ])

  const allIssues = reports.flatMap(r => r.issues)
  const hasBlockers = allIssues.some(i => i.severity === 'high')

  // Format the notes as a clean prompt fragment Gemini can act on
  const linesByPriority = ['high', 'medium', 'low']
    .flatMap(sev => allIssues
      .filter(i => i.severity === sev)
      .map(i => `[${i.severity.toUpperCase()}] (${i.critic}${i.scene ? ` scene ${i.scene}` : ''}): ${i.issue} → ${i.suggestion}`))
  const notesForRevision = linesByPriority.length
    ? `CRITIC NOTES — fix each of these in the revised script (highest priority first):\n${linesByPriority.join('\n')}`
    : ''

  return { reports, allIssues, hasBlockers, notesForRevision }
}
