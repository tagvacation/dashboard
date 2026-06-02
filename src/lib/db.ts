import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false },
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})

// Initialize tables — called once at startup
let _initDone = false
let _initPromise: Promise<void> | null = null

async function createTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '📺',
      sheet_id TEXT NOT NULL,
      sheet_tab TEXT DEFAULT 'Sheet2',
      gcs_bucket TEXT NOT NULL,
      yt_refresh_token TEXT,
      yt_client_id TEXT,
      yt_client_secret TEXT,
      yt_redirect_uri TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      is_active BOOLEAN DEFAULT true
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      story_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'init',
      log JSONB DEFAULT '[]',
      topic TEXT DEFAULT '',
      theme TEXT DEFAULT '',
      script_json TEXT DEFAULT '',
      operation_ids JSONB DEFAULT '{}',
      completed_clips JSONB DEFAULT '[]',
      filtered_clips JSONB DEFAULT '[]',
      error TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `
}

export async function ensureDb(): Promise<void> {
  if (_initDone) return
  if (!_initPromise) _initPromise = createTables().then(() => { _initDone = true })
  await _initPromise
}

// Fire-and-forget on module load so tables exist before first request
ensureDb().catch(err => console.error('DB init error:', err))

export { sql }

// ─── Channel helpers ──────────────────────────────────────────────────────────

export interface Channel {
  id: string; name: string; emoji: string
  sheet_id: string; sheet_tab: string; gcs_bucket: string
  yt_refresh_token?: string; yt_client_id?: string
  yt_client_secret?: string; yt_redirect_uri?: string
  created_at: string; is_active: boolean
}

export const channelsDb = {
  getAll: async (): Promise<Channel[]> => {
    await ensureDb()
    return sql<Channel[]>`SELECT * FROM channels WHERE is_active = true ORDER BY created_at ASC`
  },
  getById: async (id: string): Promise<Channel | null> => {
    await ensureDb()
    const [row] = await sql<Channel[]>`SELECT * FROM channels WHERE id = ${id}`
    return row ?? null
  },
  create: async (ch: Omit<Channel, 'created_at' | 'is_active'>): Promise<Channel> => {
    await ensureDb()
    const [row] = await sql<Channel[]>`
      INSERT INTO channels (id, name, emoji, sheet_id, sheet_tab, gcs_bucket, yt_refresh_token, yt_client_id, yt_client_secret, yt_redirect_uri)
      VALUES (${ch.id}, ${ch.name}, ${ch.emoji || '📺'}, ${ch.sheet_id}, ${ch.sheet_tab || 'Sheet2'}, ${ch.gcs_bucket},
              ${ch.yt_refresh_token ?? null}, ${ch.yt_client_id ?? null}, ${ch.yt_client_secret ?? null}, ${ch.yt_redirect_uri ?? null})
      RETURNING *
    `
    return row
  },
  update: async (id: string, data: Partial<Channel>): Promise<void> => {
    await ensureDb()
    if (data.name !== undefined) await sql`UPDATE channels SET name = ${data.name} WHERE id = ${id}`
    if (data.emoji !== undefined) await sql`UPDATE channels SET emoji = ${data.emoji} WHERE id = ${id}`
    if (data.yt_refresh_token !== undefined) await sql`UPDATE channels SET yt_refresh_token = ${data.yt_refresh_token} WHERE id = ${id}`
  },
  delete: async (id: string): Promise<void> => {
    await ensureDb()
    await sql`UPDATE channels SET is_active = false WHERE id = ${id}`
  },
}

// ─── Pipeline run helpers ─────────────────────────────────────────────────────

export interface PipelineRunRow {
  story_id: string; status: string; log: unknown[]
  topic: string; theme: string; script_json: string
  operation_ids: Record<string, string>
  completed_clips: string[]; filtered_clips: string[]
  error: string; created_at: string; updated_at: string
}

export const pipelineDb = {
  create: async (storyId: string): Promise<void> => {
    await ensureDb()
    await sql`
      INSERT INTO pipeline_runs (story_id, status, created_at, updated_at)
      VALUES (${storyId}, 'init', NOW(), NOW())
      ON CONFLICT (story_id) DO NOTHING
    `
  },
  get: async (storyId: string): Promise<PipelineRunRow | null> => {
    await ensureDb()
    const [row] = await sql<PipelineRunRow[]>`SELECT * FROM pipeline_runs WHERE story_id = ${storyId}`
    return row ?? null
  },
  getRecent: async (limit = 20) => {
    await ensureDb()
    return sql<PipelineRunRow[]>`
      SELECT story_id, status, topic, theme, completed_clips, filtered_clips, operation_ids, created_at, updated_at, error
      FROM pipeline_runs ORDER BY created_at DESC LIMIT ${limit}
    `
  },
  setStep: async (storyId: string, status: string, extra?: Partial<PipelineRunRow>): Promise<void> => {
    await ensureDb()
    await sql`UPDATE pipeline_runs SET status = ${status}, updated_at = NOW() WHERE story_id = ${storyId}`
    if (!extra) return
    if (extra.topic !== undefined) await sql`UPDATE pipeline_runs SET topic = ${extra.topic} WHERE story_id = ${storyId}`
    if (extra.theme !== undefined) await sql`UPDATE pipeline_runs SET theme = ${extra.theme} WHERE story_id = ${storyId}`
    if (extra.script_json !== undefined) await sql`UPDATE pipeline_runs SET script_json = ${extra.script_json} WHERE story_id = ${storyId}`
    if (extra.operation_ids !== undefined) await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(extra.operation_ids)} WHERE story_id = ${storyId}`
    if (extra.completed_clips !== undefined) await sql`UPDATE pipeline_runs SET completed_clips = ${sql.json(extra.completed_clips)} WHERE story_id = ${storyId}`
    if (extra.filtered_clips !== undefined) await sql`UPDATE pipeline_runs SET filtered_clips = ${sql.json(extra.filtered_clips)} WHERE story_id = ${storyId}`
    if (extra.error !== undefined) await sql`UPDATE pipeline_runs SET error = ${extra.error} WHERE story_id = ${storyId}`
  },
  appendLog: async (storyId: string, msg: string): Promise<void> => {
    await ensureDb()
    const entry = `[${new Date().toISOString()}] ${msg}`
    await sql`
      UPDATE pipeline_runs
      SET log = log || ${sql.json([entry])}, updated_at = NOW()
      WHERE story_id = ${storyId}
    `
  },
  delete: async (storyId: string): Promise<void> => {
    await ensureDb()
    await sql`DELETE FROM pipeline_runs WHERE story_id = ${storyId}`
  },
}
