import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// Railway volume mounts at /data, local uses .data folder
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), '.data')
const DB_PATH = path.join(DB_DIR, 'dashboard.db')

// Ensure directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

const db = new Database(DB_PATH)

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS pipeline_runs (
    story_id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'init',
    log TEXT DEFAULT '[]',
    topic TEXT DEFAULT '',
    theme TEXT DEFAULT '',
    script_json TEXT DEFAULT '',
    operation_ids TEXT DEFAULT '{}',
    completed_clips TEXT DEFAULT '[]',
    filtered_clips TEXT DEFAULT '[]',
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

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
    created_at TEXT DEFAULT (datetime('now')),
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`)

// Default channel always comes from env — DB only stores additional channels

export interface Channel {
  id: string
  name: string
  emoji: string
  sheet_id: string
  sheet_tab: string
  gcs_bucket: string
  yt_refresh_token?: string
  yt_client_id?: string
  yt_client_secret?: string
  yt_redirect_uri?: string
  created_at: string
  is_active: number
}

export const channelsDb = {
  getAll: (): Channel[] =>
    db.prepare('SELECT * FROM channels WHERE is_active = 1 ORDER BY created_at ASC').all() as Channel[],

  getById: (id: string): Channel | undefined =>
    db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as Channel | undefined,

  create: (ch: Omit<Channel, 'created_at' | 'is_active'>): Channel => {
    db.prepare(`
      INSERT INTO channels (id, name, emoji, sheet_id, sheet_tab, gcs_bucket, yt_refresh_token, yt_client_id, yt_client_secret, yt_redirect_uri)
      VALUES (@id, @name, @emoji, @sheet_id, @sheet_tab, @gcs_bucket, @yt_refresh_token, @yt_client_id, @yt_client_secret, @yt_redirect_uri)
    `).run(ch)
    return channelsDb.getById(ch.id)!
  },

  update: (id: string, data: Partial<Channel>): void => {
    const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ')
    db.prepare(`UPDATE channels SET ${fields} WHERE id = ?`).run({ ...data, id })
  },

  delete: (id: string): void => {
    db.prepare('UPDATE channels SET is_active = 0 WHERE id = ?').run(id)
  },
}

export default db
