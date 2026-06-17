import postgres from 'postgres'
import { encryptSecret, decryptSecret } from './crypto'

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false },
  max: 10,
  idle_timeout: 20,
  connect_timeout: 30,  // Railway free-tier cold start can take 15-25s
  max_lifetime: 60 * 30, // 30 min — recycle stale connections
  onnotice: () => {}, // Suppress PostgreSQL NOTICE messages (e.g. "table already exists")
})

// Retry helper for transient connect errors (Railway proxy cold starts)
async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e: unknown) {
      lastErr = e
      const code = (e as { code?: string })?.code
      const isTransient = code === 'CONNECT_TIMEOUT' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND'
      if (!isTransient || attempt === maxAttempts) break
      const wait = attempt * 2000  // 2s, 4s, 6s backoff
      console.warn(`DB ${label} attempt ${attempt} failed (${code}). Retrying in ${wait / 1000}s...`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw lastErr
}

// Initialize tables — called once at startup
let _initDone = false
let _initPromise: Promise<void> | null = null

async function createTablesInner() {
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
  await sql`
    CREATE TABLE IF NOT EXISTS scene_jobs (
      id SERIAL PRIMARY KEY,
      story_id TEXT NOT NULL,
      scene_num TEXT NOT NULL,          -- zero-padded e.g. "01"
      beat TEXT DEFAULT '',
      video_prompt TEXT DEFAULT '',     -- full prompt used for this attempt
      tts_text TEXT DEFAULT '',
      primary_anchor TEXT DEFAULT '',
      secondary_anchor TEXT DEFAULT '',
      operation_id TEXT DEFAULT '',     -- Veo operation name
      status TEXT DEFAULT 'pending',    -- pending|submitted|polling|done|filtered|failed|manual_pending
      attempt INTEGER DEFAULT 1,        -- 1 = first try, 2 = after rewrite
      error_type TEXT DEFAULT '',       -- content_filter|timeout|api_error
      error_message TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (story_id, scene_num, attempt)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_scene_jobs_story ON scene_jobs (story_id)`

  // Content categories — different types of content with their own prompts + style
  await sql`
    CREATE TABLE IF NOT EXISTS content_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🎬',
      description TEXT DEFAULT '',
      perspective TEXT DEFAULT 'third_person',  -- third_person | first_person | character
      prompt_topic_picker TEXT DEFAULT '',       -- empty = use global settings
      prompt_script_writer TEXT DEFAULT '',
      prompt_scene_rewrite TEXT DEFAULT '',
      veo_style_suffix TEXT DEFAULT '',          -- animation style override
      scene_count_min INTEGER DEFAULT 8,
      scene_count_max INTEGER DEFAULT 10,
      is_active BOOLEAN DEFAULT true,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // GCP credentials — multiple Vertex AI accounts for Veo + TTS
  await sql`
    CREATE TABLE IF NOT EXISTS gcp_credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      sa_json TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  // Per-user default account (multi-tenant). user_id is added by migrate-to-multi-tenant.
  await sql`ALTER TABLE gcp_credentials ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
  await sql`ALTER TABLE gcp_credentials ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false`

  // Scheduled posts — DB-backed cron queue
  await sql`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id SERIAL PRIMARY KEY,
      story_id TEXT NOT NULL,
      channel_id TEXT DEFAULT 'default',
      platform TEXT NOT NULL,              -- youtube | instagram | facebook
      scheduled_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'pending',       -- pending | processing | posted | failed
      posted_at TIMESTAMPTZ,
      result_url TEXT DEFAULT '',
      error TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts (status, scheduled_at)`
  // Add metadata columns to scheduled_posts if missing
  await sql`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS title TEXT DEFAULT ''`
  await sql`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`
  await sql`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT 'shorts,hindi story,kathakar'`
  await sql`
    CREATE TABLE IF NOT EXISTS stories (
      story_id TEXT PRIMARY KEY,
      topic TEXT DEFAULT '',
      theme TEXT DEFAULT '',
      status TEXT DEFAULT 'generating',
      target_account TEXT DEFAULT 'primary',
      scenes_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      clips_generated_at TIMESTAMPTZ,
      storage_path TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      youtube_link TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    )
  `

  // Add new columns to existing stories table (safe: IF NOT EXISTS)
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS category_id TEXT DEFAULT 'kathakar'`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS channel_id TEXT DEFAULT 'default'`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS gcp_credential_id TEXT DEFAULT ''`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS youtube_link TEXT DEFAULT ''`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS final_url TEXT DEFAULT ''`
  // Shoppable-store fields (extension feed + Shopify add-to-cart)
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS store_id TEXT DEFAULT ''`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS product_url TEXT DEFAULT ''`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS product_handle TEXT DEFAULT ''`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS variant_id TEXT DEFAULT ''`

  // Stores — group a user's product videos into a storefront (for the shoppable feed).
  await sql`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      domain TEXT DEFAULT '',
      platform TEXT DEFAULT 'shopify',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // Users — email + phone, plan/role. (Also created by migrate-to-multi-tenant; idempotent here.)
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      phone TEXT,
      image_url TEXT,
      plan TEXT DEFAULT 'free',
      role TEXT DEFAULT 'user',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`

  // Email OTP codes — one in-flight code per email (PK on email = upsert replaces).
  // name/phone carried here so signup details are applied only after the code verifies.
  await sql`
    CREATE TABLE IF NOT EXISTS otp_codes (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'login',   -- login | signup
      name TEXT,
      phone TEXT,
      attempts INTEGER DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // ── Performance indexes (idempotent) — keep the dashboard fast as data grows ──
  // These were previously only in scripts/add-performance-indexes.mjs (manual run);
  // folded in here so they always exist. CREATE INDEX IF NOT EXISTS is a no-op once present.
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_user_created ON stories (user_id, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_user_channel ON stories (user_id, channel_id, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_user_store ON stories (user_id, store_id, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_scene_jobs_story_status ON scene_jobs (story_id, status)`
  await sql`CREATE INDEX IF NOT EXISTS idx_stores_user ON stores (user_id, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_gcp_credentials_user ON gcp_credentials (user_id, is_active)`
}

async function createTables(): Promise<void> {
  await withRetry(() => createTablesInner(), 'createTables')
}

export async function ensureDb(): Promise<void> {
  if (_initDone) return
  if (!_initPromise) _initPromise = createTables().then(() => { _initDone = true }).catch(err => {
    // Reset so next request can retry from scratch
    _initPromise = null
    throw err
  })
  await _initPromise
}

// Fire-and-forget on module load so tables exist before first request.
// Failures are non-fatal — first real request will retry via ensureDb().
ensureDb().catch(err => console.error('DB init error (will retry on first request):', err?.message || err))

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
  getAll: async (userId?: string): Promise<Channel[]> => {
    await ensureDb()
    if (userId) {
      return sql<Channel[]>`SELECT * FROM channels WHERE is_active = true AND user_id = ${userId} ORDER BY created_at ASC`
    }
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

// ─── Stories DB ───────────────────────────────────────────────────────────────

/** Trimmed row for the Library grid (storiesDb.listLite) — no heavy/unused columns. */
export interface StoryLite {
  story_id: string
  topic: string
  status: string
  theme: string
  category_id: string
  created_at: string
  youtube_link: string
  scenes_count: number
  store_id: string
  final_url: string
  has_audio: boolean
}

export interface StoryRow {
  story_id: string
  topic: string
  theme: string
  status: string
  target_account: string
  scenes_count: number
  created_at: string
  updated_at: string
  clips_generated_at: string | null
  storage_path: string
  audio_url: string
  youtube_link: string
  notes: string
  category_id: string
  channel_id: string
  gcp_credential_id: string
  user_id?: string
  final_url?: string
  store_id?: string
  product_url?: string
  product_handle?: string
  variant_id?: string
}

export const storiesDb = {
  create: async (s: Pick<StoryRow, 'story_id' | 'topic' | 'theme'>): Promise<void> => {
    await ensureDb()
    await sql`
      INSERT INTO stories (story_id, topic, theme, storage_path)
      VALUES (${s.story_id}, ${s.topic}, ${s.theme}, ${`stories/${s.story_id}/`})
      ON CONFLICT (story_id) DO NOTHING
    `
  },

  get: async (storyId: string): Promise<StoryRow | null> => {
    await ensureDb()
    const [row] = await sql<StoryRow[]>`SELECT * FROM stories WHERE story_id = ${storyId}`
    return row ?? null
  },

  getAll: async (channelId?: string, userId?: string): Promise<StoryRow[]> => {
    await ensureDb()
    if (channelId && userId) {
      return sql<StoryRow[]>`SELECT * FROM stories WHERE channel_id = ${channelId} AND user_id = ${userId} ORDER BY created_at DESC`
    }
    if (userId) {
      return sql<StoryRow[]>`SELECT * FROM stories WHERE user_id = ${userId} ORDER BY created_at DESC`
    }
    if (channelId) {
      return sql<StoryRow[]>`SELECT * FROM stories WHERE channel_id = ${channelId} ORDER BY created_at DESC`
    }
    return sql<StoryRow[]>`SELECT * FROM stories ORDER BY created_at DESC`
  },

  // Lightweight list for the Library grid: only the columns the grid needs (no SELECT *),
  // with an optional store filter. Keeps the list query small + index-friendly.
  listLite: async (userId: string, opts?: { storeId?: string; channelId?: string }): Promise<StoryLite[]> => {
    await ensureDb()
    const storeId = opts?.storeId
    const channelId = opts?.channelId
    const cols = sql`story_id, topic, status, theme, category_id, created_at, youtube_link,
      scenes_count, store_id, final_url, (audio_url <> '') AS has_audio`
    if (storeId) {
      return sql<StoryLite[]>`SELECT ${cols} FROM stories WHERE user_id = ${userId} AND store_id = ${storeId} ORDER BY created_at DESC`
    }
    if (channelId) {
      return sql<StoryLite[]>`SELECT ${cols} FROM stories WHERE user_id = ${userId} AND channel_id = ${channelId} ORDER BY created_at DESC`
    }
    return sql<StoryLite[]>`SELECT ${cols} FROM stories WHERE user_id = ${userId} ORDER BY created_at DESC`
  },

  update: async (storyId: string, updates: Partial<Omit<StoryRow, 'story_id' | 'created_at'>>): Promise<void> => {
    await ensureDb()
    const now = new Date().toISOString()
    if (updates.status !== undefined) await sql`UPDATE stories SET status = ${updates.status}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.topic !== undefined) await sql`UPDATE stories SET topic = ${updates.topic}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.scenes_count !== undefined) await sql`UPDATE stories SET scenes_count = ${updates.scenes_count}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.audio_url !== undefined) await sql`UPDATE stories SET audio_url = ${updates.audio_url}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.youtube_link !== undefined) await sql`UPDATE stories SET youtube_link = ${updates.youtube_link}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.notes !== undefined) await sql`UPDATE stories SET notes = ${updates.notes}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.clips_generated_at !== undefined) await sql`UPDATE stories SET clips_generated_at = ${updates.clips_generated_at ?? null}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.storage_path !== undefined) await sql`UPDATE stories SET storage_path = ${updates.storage_path}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.category_id !== undefined) await sql`UPDATE stories SET category_id = ${updates.category_id}, updated_at = ${now} WHERE story_id = ${storyId}`
    if (updates.channel_id !== undefined) await sql`UPDATE stories SET channel_id = ${updates.channel_id}, updated_at = ${now} WHERE story_id = ${storyId}`
  },

  delete: async (storyId: string): Promise<void> => {
    await ensureDb()
    await sql`DELETE FROM stories WHERE story_id = ${storyId}`
  },
}

// ─── Scene Jobs ───────────────────────────────────────────────────────────────

export interface SceneJob {
  id: number
  story_id: string
  scene_num: string
  beat: string
  video_prompt: string
  tts_text: string
  primary_anchor: string
  secondary_anchor: string
  operation_id: string
  status: 'pending' | 'submitted' | 'polling' | 'done' | 'filtered' | 'failed' | 'manual_pending'
  attempt: number
  error_type: string
  error_message: string
  created_at: string
  updated_at: string
}

export const sceneJobsDb = {
  create: async (job: Pick<SceneJob, 'story_id' | 'scene_num' | 'beat' | 'video_prompt' | 'tts_text' | 'primary_anchor' | 'secondary_anchor' | 'attempt'>): Promise<SceneJob> => {
    await ensureDb()
    const [row] = await sql<SceneJob[]>`
      INSERT INTO scene_jobs (story_id, scene_num, beat, video_prompt, tts_text, primary_anchor, secondary_anchor, attempt)
      VALUES (${job.story_id}, ${job.scene_num}, ${job.beat}, ${job.video_prompt}, ${job.tts_text}, ${job.primary_anchor}, ${job.secondary_anchor}, ${job.attempt})
      ON CONFLICT (story_id, scene_num, attempt) DO UPDATE SET
        video_prompt = EXCLUDED.video_prompt,
        status = 'pending',
        updated_at = NOW()
      RETURNING *
    `
    return row
  },

  update: async (storyId: string, sceneNum: string, attempt: number, updates: Partial<SceneJob>): Promise<void> => {
    await ensureDb()
    const now = new Date().toISOString()
    if (updates.operation_id !== undefined) await sql`UPDATE scene_jobs SET operation_id = ${updates.operation_id}, updated_at = ${now} WHERE story_id = ${storyId} AND scene_num = ${sceneNum} AND attempt = ${attempt}`
    if (updates.status !== undefined) await sql`UPDATE scene_jobs SET status = ${updates.status}, updated_at = ${now} WHERE story_id = ${storyId} AND scene_num = ${sceneNum} AND attempt = ${attempt}`
    if (updates.error_type !== undefined) await sql`UPDATE scene_jobs SET error_type = ${updates.error_type}, error_message = ${updates.error_message ?? ''}, updated_at = ${now} WHERE story_id = ${storyId} AND scene_num = ${sceneNum} AND attempt = ${attempt}`
  },

  getByStory: async (storyId: string): Promise<SceneJob[]> => {
    await ensureDb()
    return sql<SceneJob[]>`SELECT * FROM scene_jobs WHERE story_id = ${storyId} ORDER BY scene_num, attempt`
  },

  getManualPending: async (storyId: string): Promise<SceneJob[]> => {
    await ensureDb()
    return sql<SceneJob[]>`SELECT * FROM scene_jobs WHERE story_id = ${storyId} AND status = 'manual_pending' ORDER BY scene_num`
  },

  deleteByStory: async (storyId: string): Promise<void> => {
    await ensureDb()
    await sql`DELETE FROM scene_jobs WHERE story_id = ${storyId}`
  },
}

// ─── Content Categories ───────────────────────────────────────────────────────

export interface ContentCategory {
  id: string; name: string; emoji: string; description: string
  perspective: string; prompt_topic_picker: string; prompt_script_writer: string
  prompt_scene_rewrite: string; veo_style_suffix: string
  scene_count_min: number; scene_count_max: number
  is_active: boolean; is_default: boolean; created_at: string
}

export const categoriesDb = {
  getAll: async (): Promise<ContentCategory[]> => {
    await ensureDb()
    return sql<ContentCategory[]>`SELECT * FROM content_categories WHERE is_active = true ORDER BY is_default DESC, created_at ASC`
  },
  get: async (id: string): Promise<ContentCategory | null> => {
    await ensureDb()
    const [row] = await sql<ContentCategory[]>`SELECT * FROM content_categories WHERE id = ${id}`
    return row ?? null
  },
  getDefault: async (): Promise<ContentCategory | null> => {
    await ensureDb()
    const [row] = await sql<ContentCategory[]>`SELECT * FROM content_categories WHERE is_default = true LIMIT 1`
    return row ?? null
  },
  upsert: async (cat: Omit<ContentCategory, 'created_at'>): Promise<ContentCategory> => {
    await ensureDb()
    if (cat.is_default) await sql`UPDATE content_categories SET is_default = false`
    const [row] = await sql<ContentCategory[]>`
      INSERT INTO content_categories (id, name, emoji, description, perspective, prompt_topic_picker, prompt_script_writer, prompt_scene_rewrite, veo_style_suffix, scene_count_min, scene_count_max, is_active, is_default)
      VALUES (${cat.id}, ${cat.name}, ${cat.emoji}, ${cat.description}, ${cat.perspective},
              ${cat.prompt_topic_picker}, ${cat.prompt_script_writer}, ${cat.prompt_scene_rewrite},
              ${cat.veo_style_suffix}, ${cat.scene_count_min}, ${cat.scene_count_max}, ${cat.is_active}, ${cat.is_default})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, emoji = EXCLUDED.emoji, description = EXCLUDED.description,
        perspective = EXCLUDED.perspective, prompt_topic_picker = EXCLUDED.prompt_topic_picker,
        prompt_script_writer = EXCLUDED.prompt_script_writer, prompt_scene_rewrite = EXCLUDED.prompt_scene_rewrite,
        veo_style_suffix = EXCLUDED.veo_style_suffix, scene_count_min = EXCLUDED.scene_count_min,
        scene_count_max = EXCLUDED.scene_count_max, is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default
      RETURNING *
    `
    return row
  },
  delete: async (id: string): Promise<void> => {
    await ensureDb()
    await sql`UPDATE content_categories SET is_active = false WHERE id = ${id}`
  },
}

// ─── GCP Credentials ──────────────────────────────────────────────────────────

export interface GcpCredential {
  id: string; name: string; project_id: string; bucket: string
  sa_json: string; is_active: boolean; created_at: string
  user_id?: string; is_default?: boolean
}

export const gcpCredentialsDb = {
  getAll: async (userId?: string): Promise<Omit<GcpCredential, 'sa_json'>[]> => {
    await ensureDb()
    if (userId) {
      return sql<Omit<GcpCredential, 'sa_json'>[]>`SELECT id, name, project_id, bucket, is_active, created_at FROM gcp_credentials WHERE is_active = true AND user_id = ${userId} ORDER BY created_at`
    }
    return sql<Omit<GcpCredential, 'sa_json'>[]>`SELECT id, name, project_id, bucket, is_active, created_at FROM gcp_credentials WHERE is_active = true ORDER BY created_at`
  },
  get: async (id: string): Promise<GcpCredential | null> => {
    await ensureDb()
    const [row] = await sql<GcpCredential[]>`SELECT * FROM gcp_credentials WHERE id = ${id}`
    if (!row) return null
    return { ...row, sa_json: decryptSecret(row.sa_json) }  // decrypt at read
  },
  // The user's chosen default account (else most-recent active). Null = user has none.
  getDefaultForUser: async (userId: string): Promise<GcpCredential | null> => {
    await ensureDb()
    const [row] = await sql<GcpCredential[]>`
      SELECT * FROM gcp_credentials
      WHERE user_id = ${userId} AND is_active = true
      ORDER BY is_default DESC, created_at DESC
      LIMIT 1
    `
    if (!row) return null
    return { ...row, sa_json: decryptSecret(row.sa_json) }
  },
  create: async (cred: Omit<GcpCredential, 'created_at' | 'is_active'>): Promise<void> => {
    await ensureDb()
    const enc = encryptSecret(cred.sa_json)  // encrypt at rest
    await sql`
      INSERT INTO gcp_credentials (id, name, project_id, bucket, sa_json, user_id, is_default)
      VALUES (${cred.id}, ${cred.name}, ${cred.project_id}, ${cred.bucket}, ${enc}, ${cred.user_id ?? null}, ${cred.is_default ?? false})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, project_id = EXCLUDED.project_id,
        bucket = EXCLUDED.bucket, sa_json = EXCLUDED.sa_json
    `
  },
  // Mark one credential the user's default (unset their others).
  setDefault: async (userId: string, id: string): Promise<void> => {
    await ensureDb()
    await sql`UPDATE gcp_credentials SET is_default = (id = ${id}) WHERE user_id = ${userId}`
  },
  delete: async (id: string): Promise<void> => {
    await ensureDb()
    await sql`UPDATE gcp_credentials SET is_active = false WHERE id = ${id}`
  },
}

// ─── Scheduled Posts ──────────────────────────────────────────────────────────

export interface ScheduledPost {
  id: number; story_id: string; channel_id: string; platform: string
  scheduled_at: string; status: string; posted_at: string | null
  result_url: string; error: string; created_at: string
  title: string; description: string; tags: string
}

export const scheduledPostsDb = {
  create: async (post: Pick<ScheduledPost, 'story_id' | 'channel_id' | 'platform' | 'scheduled_at' | 'title' | 'description' | 'tags'>): Promise<ScheduledPost> => {
    await ensureDb()
    const [row] = await sql<ScheduledPost[]>`
      INSERT INTO scheduled_posts (story_id, channel_id, platform, scheduled_at, title, description, tags)
      VALUES (${post.story_id}, ${post.channel_id}, ${post.platform}, ${post.scheduled_at}, ${post.title}, ${post.description}, ${post.tags})
      RETURNING *
    `
    return row
  },

  update_meta: async (id: number, title: string, description: string, tags: string): Promise<void> => {
    await ensureDb()
    await sql`UPDATE scheduled_posts SET title = ${title}, description = ${description}, tags = ${tags} WHERE id = ${id}`
  },
  getPending: async (): Promise<ScheduledPost[]> => {
    await ensureDb()
    return sql<ScheduledPost[]>`
      SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= NOW() ORDER BY scheduled_at ASC LIMIT 10
    `
  },
  getByStory: async (storyId: string): Promise<ScheduledPost[]> => {
    await ensureDb()
    return sql<ScheduledPost[]>`SELECT * FROM scheduled_posts WHERE story_id = ${storyId} ORDER BY scheduled_at`
  },
  getUpcoming: async (limit = 20): Promise<ScheduledPost[]> => {
    await ensureDb()
    return sql<ScheduledPost[]>`
      SELECT sp.*, s.topic FROM scheduled_posts sp
      LEFT JOIN stories s ON sp.story_id = s.story_id
      WHERE sp.status IN ('pending', 'failed')
      ORDER BY sp.scheduled_at ASC LIMIT ${limit}
    `
  },
  update: async (id: number, updates: Partial<ScheduledPost>): Promise<void> => {
    await ensureDb()
    if (updates.status !== undefined) await sql`UPDATE scheduled_posts SET status = ${updates.status} WHERE id = ${id}`
    if (updates.result_url !== undefined) await sql`UPDATE scheduled_posts SET result_url = ${updates.result_url}, posted_at = NOW() WHERE id = ${id}`
    if (updates.error !== undefined) await sql`UPDATE scheduled_posts SET error = ${updates.error} WHERE id = ${id}`
  },
  delete: async (id: number): Promise<void> => {
    await ensureDb()
    await sql`DELETE FROM scheduled_posts WHERE id = ${id}`
  },
}

// ─── Stores (shoppable feed) ──────────────────────────────────────────────────

export interface Store { id: string; user_id: string; name: string; domain: string; platform: string; created_at: string }

export const storesDb = {
  getAll: async (userId: string): Promise<Store[]> => {
    await ensureDb()
    return sql<Store[]>`SELECT * FROM stores WHERE user_id = ${userId} ORDER BY created_at DESC`
  },
  get: async (id: string): Promise<Store | null> => {
    await ensureDb()
    const [row] = await sql<Store[]>`SELECT * FROM stores WHERE id = ${id}`
    return row ?? null
  },
  create: async (s: { id: string; user_id: string; name: string; domain?: string; platform?: string }): Promise<void> => {
    await ensureDb()
    await sql`
      INSERT INTO stores (id, user_id, name, domain, platform)
      VALUES (${s.id}, ${s.user_id}, ${s.name}, ${s.domain ?? ''}, ${s.platform ?? 'shopify'})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, domain = EXCLUDED.domain, platform = EXCLUDED.platform
    `
  },
  // Rows needed to build the shoppable feed (only finished videos with a product URL).
  feedRows: async (storeId: string, userId: string) => {
    await ensureDb()
    return sql<{ story_id: string; topic: string; product_url: string; product_handle: string; variant_id: string; final_url: string }[]>`
      SELECT story_id, topic, product_url, product_handle, variant_id, final_url
      FROM stories
      WHERE store_id = ${storeId} AND user_id = ${userId}
        AND status = 'post_produced' AND product_url <> '' AND final_url <> ''
      ORDER BY created_at DESC
    `
  },
}

// ─── Settings / Prompts ───────────────────────────────────────────────────────

export const settingsDb = {
  get: async (key: string, defaultValue = ''): Promise<string> => {
    await ensureDb()
    const [row] = await sql<{ value: string }[]>`SELECT value FROM settings WHERE key = ${key}`
    return row?.value ?? defaultValue
  },

  set: async (key: string, value: string): Promise<void> => {
    await ensureDb()
    await sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}
    `
  },

  getAll: async (): Promise<Record<string, string>> => {
    await ensureDb()
    const rows = await sql<{ key: string; value: string }[]>`SELECT key, value FROM settings`
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  },
}
