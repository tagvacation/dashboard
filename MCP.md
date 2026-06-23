# Mascot-Lab MCP — the two-agent "middle point"

Both Claude agents connect to **one MCP server** that exposes the test/critic loop + a **shared
experiments log** (a DB table). They drive the *same* loop and build on each other's results —
no WhatsApp, no free-form chat that drifts; they converge on the objective critic score.

```
Agent A ─┐                          ┌─ run_test / list_experiments / log_note
         ├──►  mascot-lab MCP  ◄────┤
Agent B ─┘     (stdio, this repo)   └─ writes to  → experiments table (shared)
```

## Tools
- **`list_products(limit?)`** — products (ad story ids + names) you can test on.
- **`list_accounts()`** — inventory of Cloud accounts (for visibility; shows which buckets are usable). Storage always uses the main account regardless.
- **`run_test(productStoryId, render?, scenes?, agent?, change?)`** — generate a mascot ad + score it with the visual critic. Default = **cheap stills** (no Veo); `render:true` = full Veo render (slow, costs credits). All assets go to the main bucket. Always logs to the shared experiments table. Pass `agent` (your name) + `change` (what you're trying).
- **`list_experiments(limit?)`** — read what every agent has tried + the critic scores. **Call this first** so you build on prior results instead of repeating them.
- **`log_note(agent, note)`** — post a coordination note for the other agent.

## Storage vs compute (important)
**All assets always land in the main account's single bucket** (`ai_clip_007`) — storage never
follows a per-account credential (several are misconfigured, bucket `"no-name"`).

The 429 throttle on two agents grinding is **Vertex rate limits**, not tokens. The fix —
**spreading Veo/nano *compute* across accounts** — is feasible (Veo returns bytes, so compute quota
is decoupled from the bucket) but **not wired yet**: it needs (1) a 2nd *working* compute account
(right now only the main one works — `sheet-422907`/`level-hope` are inactive, `UV Kunj` has a broken
`"no-name"` bucket + org-policy SA issues), and (2) a compute/storage credential split in the pipeline
so storage stays on main. Until then, both agents share the main account's quota — stagger heavy
`render:true` runs to avoid 429s.

## Connect (each agent)
This repo ships a project-scoped `.mcp.json`, so a Claude **in this repo** picks it up automatically
(approve it on start). For the **other agent** (Claude Desktop / another machine), add:

```json
{
  "mcpServers": {
    "mascot-lab": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp-lab.mts"],
      "cwd": "/ABSOLUTE/PATH/TO/dashboard"
    }
  }
}
```
It needs the repo + a working `.env` (DATABASE_URL, GCS_* main account). The shared **experiments
table lives in the DB**, so both agents see the same log regardless of machine.

## The loop both agents run
1. `list_experiments` — see what's been tried.
2. `run_test(product, change:"...")` — try one change, get the critic score (cheap stills first).
3. If a stills idea scores well, `run_test(..., render:true)` to confirm on video. Stagger heavy renders between agents (shared quota).
4. `log_note` anything the other agent should know. Repeat until scores plateau high.

## Notes
- The server redirects pipeline `console.log` → stderr so it doesn't corrupt the MCP stdio protocol.
- `run_test` with `render:true` can take ~6 min (Veo) and costs credits; stills mode is ~₹30.
- Manual run for debugging: `npm run mcp`.
