/**
 * Script-improvement loop:
 *   write → critique (4 critics in parallel) → revise once → re-critique → ship
 *
 * Cap at ONE revision pass — Gemini fixing critic notes for a SECOND time often
 * makes things worse (it starts breaking the parts the critics didn't complain about).
 * The single pass plus a forbidden-list seed in the FIRST write is where most of
 * the quality lift comes from.
 */
import type { GcpContext } from './auth'
import { runAllCritics, type CriticSummary } from './critics'

export interface ScriptLoopOpts<T> {
  initialGenerate: () => Promise<T>
  reviseGenerate: (notes: string, prev: T) => Promise<T>
  product: Record<string, unknown>
  forbidden: { settings: string[]; villains: string[]; mascots: string[] }
  ctx: GcpContext
  log: (msg: string) => Promise<void>
  /** Skip critic loop entirely (escape hatch). Default false. */
  disabled?: boolean
}

export interface ScriptLoopResult<T> {
  script: T
  passes: number          // 1 = critic-clean on first try; 2 = needed one revision
  finalCriticSummary: CriticSummary | null
}

export async function runScriptLoop<T>(
  opts: ScriptLoopOpts<T>,
): Promise<ScriptLoopResult<T>> {
  const { initialGenerate, reviseGenerate, product, forbidden, ctx, log, disabled } = opts

  // First write
  await log('Writing script (pass 1)...')
  let script = await initialGenerate()

  if (disabled) return { script, passes: 1, finalCriticSummary: null }

  // First critique
  await log('Running 4 critics in parallel (diversity, specificity, composition, coherence)...')
  const t0 = Date.now()
  let summary = await runAllCritics(script as unknown as Record<string, unknown>, product, forbidden, ctx)
  await log(`Critics done in ${Math.round((Date.now() - t0) / 1000)}s — ${summary.allIssues.length} issues (${summary.allIssues.filter(i => i.severity === 'high').length} high)`)

  // If no blockers, ship it
  if (!summary.hasBlockers) {
    if (summary.allIssues.length > 0) await log(`(non-blocking notes ignored: ${summary.allIssues.length})`)
    return { script, passes: 1, finalCriticSummary: summary }
  }

  // Revision pass
  await log('Revising script with critic notes...')
  try {
    const revised = await reviseGenerate(summary.notesForRevision, script)
    script = revised

    // Re-critique to log final state (but DON'T loop again)
    await log('Re-running critics on revised script...')
    const after = await runAllCritics(script as unknown as Record<string, unknown>, product, forbidden, ctx)
    const remaining = after.allIssues.filter(i => i.severity === 'high').length
    await log(`Revised — ${remaining} high-sev remaining (shipping anyway, single-pass cap)`)
    return { script, passes: 2, finalCriticSummary: after }
  } catch (e) {
    await log(`Revision failed (${e instanceof Error ? e.message : e}); shipping original draft`)
    return { script, passes: 1, finalCriticSummary: summary }
  }
}
