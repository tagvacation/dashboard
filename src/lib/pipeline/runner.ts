import { Storage } from '@google-cloud/storage'
import { google } from 'googleapis'
import db from '../db'
import { pickTopic, writeScript } from './gemini'
import { submitAllScenes, pollAllScenes } from './veo'
import { generateFullNarration } from './tts'
import type { PipelineStep, Script } from './types'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

// ─── Sheets helper (column-aware update) ─────────────────────────────────────

async function updateSheet(storyId: string, updates: Record<string, string>) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const sheetId = process.env.SHEET_ID!
  const tab = process.env.SHEET_TAB || 'Sheet2'

  // Read header row to find column indices
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!1:1` })
  const headers: string[] = (headerRes.data.values?.[0] || []) as string[]

  // Find the row with this story_id
  const allRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A:A` })
  const idCol = allRes.data.values || []
  const rowIdx = idCol.findIndex((r) => r[0] === storyId)
  if (rowIdx === -1) return
  const rowNum = rowIdx + 1 // 1-indexed

  // Build batch update
  const data = Object.entries(updates)
    .filter(([key]) => headers.includes(key))
    .map(([key, val]) => {
      const colIdx = headers.indexOf(key)
      const col = String.fromCharCode(65 + colIdx)
      return { range: `${tab}!${col}${rowNum}`, values: [[val]] }
    })

  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data },
    })
  }
}

async function appendToSheet(row: Record<string, string>) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const sheetId = process.env.SHEET_ID!
  const tab = process.env.SHEET_TAB || 'Sheet2'

  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!1:1` })
  const headers: string[] = (headerRes.data.values?.[0] || []) as string[]

  // Check if story already exists — if yes, just update instead of appending duplicate
  const allIdRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A:A` })
  const existing = (allIdRes.data.values || []).findIndex((r) => r[0] === row.story_id)
  if (existing !== -1) {
    await updateSheet(row.story_id, row)
    return
  }

  const rowValues = headers.map(h => row[h] || '')
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:A`,
    valueInputOption: 'RAW',
    requestBody: { values: [rowValues] },
  })
}

// ─── GCS helpers ─────────────────────────────────────────────────────────────

async function uploadBuffer(path: string, buf: Buffer, mimeType: string) {
  const file = bucket.file(path)
  await file.save(buf, { contentType: mimeType })
  return `${PUBLIC_BASE}/${path}`
}

async function gcsExists(path: string): Promise<boolean> {
  const [exists] = await bucket.file(path).exists()
  return exists
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

function logStep(storyId: string, msg: string) {
  const run = db.prepare('SELECT log FROM pipeline_runs WHERE story_id = ?').get(storyId) as { log: string } | undefined
  const logs: string[] = run ? JSON.parse(run.log || '[]') : []
  logs.push(`[${new Date().toISOString()}] ${msg}`)
  db.prepare('UPDATE pipeline_runs SET log = ?, updated_at = ? WHERE story_id = ?')
    .run(JSON.stringify(logs), new Date().toISOString(), storyId)
}

function setStep(storyId: string, step: PipelineStep, extra?: Record<string, string>) {
  const now = new Date().toISOString()
  if (!extra || Object.keys(extra).length === 0) {
    db.prepare('UPDATE pipeline_runs SET status = ?, updated_at = ? WHERE story_id = ?').run(step, now, storyId)
    return
  }
  // Build SET clause dynamically — only allow known safe column names
  const SAFE_COLS = new Set(['topic', 'theme', 'script_json', 'operation_ids', 'completed_clips', 'filtered_clips', 'error'])
  const filtered = Object.entries(extra).filter(([k]) => SAFE_COLS.has(k))
  if (filtered.length === 0) {
    db.prepare('UPDATE pipeline_runs SET status = ?, updated_at = ? WHERE story_id = ?').run(step, now, storyId)
    return
  }
  const setClauses = ['status = ?', 'updated_at = ?', ...filtered.map(([k]) => `${k} = ?`)]
  const values: unknown[] = [step, now, ...filtered.map(([, v]) => v), storyId]
  db.prepare(`UPDATE pipeline_runs SET ${setClauses.join(', ')} WHERE story_id = ?`).run(...values)
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runPipeline(storyId: string) {
  const log = (msg: string) => { logStep(storyId, msg); console.log(`[${storyId}] ${msg}`) }

  try {
    let run = db.prepare('SELECT * FROM pipeline_runs WHERE story_id = ?').get(storyId) as Record<string, string>
    if (!run) throw new Error('Pipeline run not found in DB')

    // ── Step 1: Pick Topic ──────────────────────────────────────────────────
    let topic = run.topic
    let theme = run.theme

    if (!topic) {
      log('Picking topic...')
      setStep(storyId, 'topic')
      const result = await pickTopic(storyId)
      topic = result.topic
      theme = result.theme
      setStep(storyId, 'topic', { topic, theme })
      log(`Topic: ${topic}`)

      // Add to sheet
      await appendToSheet({
        story_id: storyId,
        topic,
        theme,
        status: 'generating',
        target_account: 'primary',
        created_at: new Date().toISOString(),
      })
    }

    // ── Step 2: Write Script ────────────────────────────────────────────────
    let script: Script
    if (run.script_json) {
      script = JSON.parse(run.script_json)
      log(`Loaded script from DB (${script.total_scenes} scenes)`)
    } else {
      log('Writing script...')
      setStep(storyId, 'script')
      script = await writeScript(storyId, topic, theme)
      setStep(storyId, 'script', { script_json: JSON.stringify(script) })
      log(`Script written: "${script.title_hindi}" — ${script.total_scenes} scenes`)
    }

    // ── Step 3: Generate Audio ──────────────────────────────────────────────
    const audioPath = `stories/${storyId}/audio/full_narration.mp3`
    const audioExists = await gcsExists(audioPath)

    if (!audioExists) {
      log('Generating TTS audio...')
      setStep(storyId, 'audio')
      const audioBuffer = await generateFullNarration(script.scenes)
      const audioUrl = await uploadBuffer(audioPath, audioBuffer, 'audio/mpeg')
      log(`Audio uploaded: ${audioUrl}`)

      // Update sheet with meta
      await updateSheet(storyId, {
        scenes_count: String(script.total_scenes),
        storage_path: `stories/${storyId}/`,
        audio_url: audioUrl,
      })
    } else {
      log('Audio already exists, skipping TTS')
    }

    // ── Step 4: Submit scenes to Veo ────────────────────────────────────────
    let operationIds: Record<string, string> = run.operation_ids ? JSON.parse(run.operation_ids) : {}
    const completedClips: string[] = run.completed_clips ? JSON.parse(run.completed_clips) : []
    const filteredClips: string[] = run.filtered_clips ? JSON.parse(run.filtered_clips) : []

    // Only submit scenes that haven't been submitted or completed
    const doneScenes = new Set([...completedClips, ...filteredClips, ...Object.keys(operationIds)])
    const scenesToSubmit = script.scenes.filter(s => !doneScenes.has(s.scene_num))

    if (scenesToSubmit.length > 0) {
      log(`Submitting ${scenesToSubmit.length} scenes to Veo...`)
      setStep(storyId, 'veo_submit')
      const newOps = await submitAllScenes(scenesToSubmit, log)
      Object.assign(operationIds, newOps)
      setStep(storyId, 'veo_submit', { operation_ids: JSON.stringify(operationIds) })
    } else {
      log('All scenes already submitted')
    }

    // ── Step 5: Poll Veo + Upload clips ─────────────────────────────────────
    const pendingOps = Object.fromEntries(
      Object.entries(operationIds).filter(([sceneNum]) => !completedClips.includes(sceneNum))
    )

    if (Object.keys(pendingOps).length > 0) {
      log(`Polling ${Object.keys(pendingOps).length} pending scenes...`)
      setStep(storyId, 'veo_poll')

      const { completed, filtered } = await pollAllScenes(
        pendingOps,
        (sceneNum, status) => {
          const run = db.prepare('SELECT * FROM pipeline_runs WHERE story_id = ?').get(storyId) as Record<string, string>
          const clips: string[] = run.completed_clips ? JSON.parse(run.completed_clips) : []
          const filtd: string[] = run.filtered_clips ? JSON.parse(run.filtered_clips) : []

          if (status === 'done' && !clips.includes(sceneNum)) clips.push(sceneNum)
          if (status === 'filtered' && !filtd.includes(sceneNum)) filtd.push(sceneNum)

          db.prepare('UPDATE pipeline_runs SET completed_clips = ?, filtered_clips = ?, updated_at = ? WHERE story_id = ?')
            .run(JSON.stringify(clips), JSON.stringify(filtd), new Date().toISOString(), storyId)
        },
        log,
      )

      // Upload completed clips
      log(`Uploading ${Object.keys(completed).length} clips to GCS...`)
      await Promise.all(
        Object.entries(completed).map(async ([sceneNum, base64]) => {
          const clipPath = `stories/${storyId}/clips/scene_${sceneNum}.mp4`
          const clipExists = await gcsExists(clipPath)
          if (!clipExists) {
            const buf = Buffer.from(base64, 'base64')
            await uploadBuffer(clipPath, buf, 'video/mp4')
            log(`  Uploaded scene_${sceneNum}.mp4`)
          }
        })
      )

      filteredClips.push(...filtered)
    } else {
      log('All clips already completed')
    }

    // ── Step 6: Complete ────────────────────────────────────────────────────
    log('Pipeline complete!')
    setStep(storyId, 'complete')
    await updateSheet(storyId, {
      status: 'clips_ready',
      clips_generated_at: new Date().toISOString(),
      ...(filteredClips.length > 0 ? { notes: `FILTERED: ${filteredClips.length} scenes blocked — check GCS for missing clips` } : {}),
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${storyId}] Pipeline failed:`, msg)
    logStep(storyId, `ERROR: ${msg}`)
    setStep(storyId, 'failed', { error: msg })
    try {
      await updateSheet(storyId, { status: 'failed', notes: `Pipeline error: ${msg}` })
    } catch { /* ignore sheet error */ }
  }
}
