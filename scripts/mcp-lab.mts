/**
 * Mascot-Lab MCP server — the shared "middle point" two Claude agents connect to.
 *
 * Exposes the test/critic loop + the shared experiments log as MCP tools, so both agents
 * (this one + your higher-token one) drive the SAME loop and build on each other's results.
 *
 *   Run:  npm run mcp        (stdio transport)
 *   Connect (each agent), e.g. .mcp.json:
 *     { "mcpServers": { "mascot-lab": { "command": "npm", "args": ["run","mcp"],
 *       "cwd": "/Users/aman_thakur/Automate/dashboard" } } }
 *
 * Tools: list_products · list_accounts · run_test · list_experiments · log_note
 *
 * Storage: ALL assets always go to the main account's bucket (project directive — one shared
 * bucket). Compute-quota spreading across accounts (to dodge Veo/nano 429s) is a future step:
 * Veo returns bytes so compute is decoupled from storage, but it needs a 2nd *working* compute
 * account + a compute/storage credential split in the pipeline. See MCP.md.
 */
import { readFileSync } from 'fs'
// Resolve .env relative to THIS script (repo root) so it works regardless of cwd / which laptop.
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).replace(/^["']|["']$/g, '') }

// CRITICAL: MCP uses stdout for the protocol — redirect all pipeline console.log to stderr.
console.log = (...a: unknown[]) => console.error(...a)

const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = await import('zod')
const { sql, experimentsDb, gcpCredentialsDb } = await import('../src/lib/db.ts')
const { runMascotTest } = await import('../src/lib/pipeline/lab.ts')

const text = (o: unknown) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] })

const server = new McpServer({ name: 'mascot-lab', version: '1.0.0' })

server.tool(
  'list_products',
  'List recent products (ad story ids + names) you can run a mascot test on.',
  { limit: z.number().optional() },
  async ({ limit }: { limit?: number }) => {
    const rows = await sql<{ story_id: string; topic: string }[]>`
      SELECT story_id, topic FROM stories WHERE theme = 'ai_ad' AND story_id NOT LIKE 'test_%' ORDER BY created_at DESC LIMIT ${limit || 20}`
    return text(rows.map(r => ({ productStoryId: r.story_id, name: r.topic })))
  },
)

server.tool(
  'list_accounts',
  'Inventory of Google Cloud accounts. STORAGE always uses the main account (one shared bucket) — this is just visibility into which accounts exist and which buckets are usable (bucket "no-name" = misconfigured). Compute-quota spreading across accounts is a future step (see MCP.md).',
  {},
  async () => {
    const creds = await gcpCredentialsDb.getAll().catch(() => [])
    const accounts = [
      { account: 'env', project_id: process.env.GCP_PROJECT_ID, bucket: process.env.GCS_BUCKET, name: 'shared main (env)', storage: true },
      ...creds.map(c => ({ account: c.id, project_id: c.project_id, bucket: c.bucket, name: c.name, usable_bucket: c.bucket !== 'no-name' })),
    ]
    return text(accounts)
  },
)

server.tool(
  'run_test',
  'Generate a mascot ad for a product and score it with the visual critic. Default = cheap stills (no Veo). render=true does a full Veo render (slow, costs credits). All assets go to the main storage account. Logs the result to the shared experiments table.',
  { productStoryId: z.string(), render: z.boolean().optional(), scenes: z.number().optional(), agent: z.string().optional(), change: z.string().optional() },
  async ({ productStoryId, render, scenes, agent, change }: { productStoryId: string; render?: boolean; scenes?: number; agent?: string; change?: string }) => {
    const r = await runMascotTest(productStoryId, { render, scenes, agent, change })
    return text({
      storyId: r.storyId, verdict: r.score.verdict, overall: r.score.overall,
      product_fidelity: r.score.product_fidelity, character_consistency: r.score.character_consistency,
      stays_product: r.score.stays_product, framing: render ? r.score.framing : 'n/a (stills)', appeal: r.score.appeal,
      summary: r.score.summary, issues: r.score.issues, video: r.videoUrl, storyboard: r.storyboardUrl,
    })
  },
)

server.tool(
  'list_experiments',
  'Read the shared experiments log — what every agent has tried + the critic scores. Use it before testing so you build on prior results instead of repeating them.',
  { limit: z.number().optional() },
  async ({ limit }: { limit?: number }) => text(await experimentsDb.list(limit || 20)),
)

server.tool(
  'log_note',
  'Post a coordination note to the shared log (e.g. what you are about to try, or a finding) so the other agent sees it.',
  { agent: z.string(), note: z.string() },
  async ({ agent, note }: { agent: string; note: string }) => {
    await experimentsDb.log({ agent, change: 'note', notes: note })
    return text('logged')
  },
)

await server.connect(new StdioServerTransport())
console.error('[mascot-lab MCP] ready (stdio)')
