import { google } from 'googleapis'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

export interface Story {
  story_id: string
  topic: string
  theme: string
  status: string
  target_account: string
  scenes_count: string
  created_at: string
  clips_generated_at: string
  storage_path: string
  audio_url: string
  youtube_link: string   // YouTube Short URL after upload
  notes: string
  merged_at: string
}

export async function getAllStories(): Promise<Story[]> {
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_TAB}!A:N`,
  })

  const rows = res.data.values || []
  if (rows.length < 2) return []

  const headers = rows[0]
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = row[i] || '' })
    return obj as unknown as Story
  }).filter(s => s.story_id).reverse() // newest first
}

export async function updateStoryStatus(storyId: string, updates: Partial<Story>) {
  const sheets = google.sheets({ version: 'v4', auth })
  const all = await getAllStories()
  const idx = all.findIndex(s => s.story_id === storyId)
  if (idx === -1) return

  // Update specific cells (implementation simplified)
  const rowNum = all.length - idx + 1 // accounting for header + reverse

  const batchData = Object.entries(updates).map(([key, val]) => ({
    range: `${process.env.SHEET_TAB}!A${rowNum}`,
    values: [[val]],
  }))

  // For now just log - full implementation in API routes
  console.log('Would update story:', storyId, updates)
}
