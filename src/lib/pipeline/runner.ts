import { Storage } from '@google-cloud/storage'
import { google } from 'googleapis'
import { pipelineDb } from '../db'
import { pickTopic, writeScript } from './gemini'
import { submitAllScenes, pollAllScenes } from './veo'
import { generateFullNarration } from './tts'
import type { PipelineStep, Script } from './types'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

// ─── Sheets helpers ───────────────────────────────────────────────────────────

async function updateSheet(storyId: string, updates: Record<string, string>) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const sheetId = process.env.SHEET_ID!
  const tab = process.env.SHEET_TAB || 'Sheet2'

  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!1:1` })
  const headers: string[] = (headerRes.data.values?.[0] || []) as string[]

  const allRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A:A` })
  const idCol = allRes.data.values || []
  const rowIdx = idCol.findIndex((r) => r[0] === storyId)
  if (rowIdx === -1) return
  const rowNum = rowIdx + 1

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

async function uploadBuffer(path: string, buf: Buffer, mimeType: string): Promise<string> {
  const file = bucket.file(path)
  await file.save(buf, { contentType: mimeType })
  return `${PUBLIC_BASE}/${path}`
}

async function gcsExists(path: string): Promise<boolean> {
  const [exists] = await bucket.file(path).exists()
  return exists
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runPipeline(storyId: string) {
  const log = async (msg: string) => {
    await pipelineDb.appendLog(storyId, msg)
    console.log(`[${storyId}] ${msg}`)
  }

  const setStep = async (step: PipelineStep, extra?: Parameters<typeof pipelineDb.setStep>[2]) => {
    await pipelineDb.setStep(storyId, step, extra)
  }

  try {
    let run = await pipelineDb.get(storyId)
    if (!run) throw new Error('Pipeline run not found in DB')

    // ── Step 1: Pick Topic ──────────────────────────────────────────────────
    let topic = run.topic
    let theme = run.theme

    if (!topic) {
      await log('Picking topic...')
      await setStep('topic')
      const result = await pickTopic(storyId)
      topic = result.topic
      theme = result.theme
      await setStep('topic', { topic, theme })
      await log(`Topic: ${topic}`)

      await appendToSheet({
        story_id: storyId, topic, theme,
        status: 'generating', target_account: 'primary',
        created_at: new Date().toISOString(),
      })
    }

    // ── Step 2: Write Script ────────────────────────────────────────────────
    let script: Script
    if (run.script_json) {
      script = JSON.parse(run.script_json)
      await log(`Script loaded (${script.total_scenes} scenes)`)
    } else {
      await log('Writing script...')
      await setStep('script')
      script = await writeScript(storyId, topic, theme)
      await setStep('script', { script_json: JSON.stringify(script) })
      await log(`Script ready: "${script.title_hindi}" — ${script.total_scenes} scenes`)
    }

    // ── Step 3: Generate Audio ──────────────────────────────────────────────
    const audioPath = `stories/${storyId}/audio/full_narration.mp3`
    if (!(await gcsExists(audioPath))) {
      await log('Generating TTS audio...')
      await setStep('audio')
      const audioBuffer = await generateFullNarration(script.scenes)
      const audioUrl = await uploadBuffer(audioPath, audioBuffer, 'audio/mpeg')
      await log(`Audio uploaded`)
      await updateSheet(storyId, {
        scenes_count: String(script.total_scenes),
        storage_path: `stories/${storyId}/`,
        audio_url: audioUrl,
      })
    } else {
      await log('Audio exists, skipping TTS')
    }

    // ── Step 4: Submit scenes to Veo ────────────────────────────────────────
    let operationIds: Record<string, string> = run.operation_ids || {}
    const completedClips: string[] = run.completed_clips || []
    const filteredClips: string[] = run.filtered_clips || []

    const doneScenes = new Set([...completedClips, ...filteredClips, ...Object.keys(operationIds)])
    const scenesToSubmit = script.scenes.filter(s => !doneScenes.has(s.scene_num))

    if (scenesToSubmit.length > 0) {
      await log(`Submitting ${scenesToSubmit.length} scenes to Veo...`)
      await setStep('veo_submit')
      const newOps = await submitAllScenes(scenesToSubmit, (msg) => { log(msg).catch(console.error) })
      Object.assign(operationIds, newOps)
      await setStep('veo_submit', { operation_ids: operationIds })
    } else {
      await log('All scenes already submitted')
    }

    // ── Step 5: Poll Veo + Upload clips ─────────────────────────────────────
    const pendingOps = Object.fromEntries(
      Object.entries(operationIds).filter(([sceneNum]) => !completedClips.includes(sceneNum))
    )

    if (Object.keys(pendingOps).length > 0) {
      await log(`Polling ${Object.keys(pendingOps).length} scenes...`)
      await setStep('veo_poll')

      const { completed, filtered } = await pollAllScenes(
        pendingOps,
        async (sceneNum, status) => {
          // Re-fetch latest state for accurate updates
          const latest = await pipelineDb.get(storyId)
          const clips: string[] = latest?.completed_clips || []
          const filtd: string[] = latest?.filtered_clips || []
          if (status === 'done' && !clips.includes(sceneNum)) {
            await pipelineDb.setStep(storyId, 'veo_poll', { completed_clips: [...clips, sceneNum] })
          }
          if (status === 'filtered' && !filtd.includes(sceneNum)) {
            await pipelineDb.setStep(storyId, 'veo_poll', { filtered_clips: [...filtd, sceneNum] })
          }
        },
        (msg) => { log(msg).catch(console.error) },
      )

      await log(`Uploading ${Object.keys(completed).length} clips...`)
      await Promise.all(
        Object.entries(completed).map(async ([sceneNum, base64]) => {
          const clipPath = `stories/${storyId}/clips/scene_${sceneNum}.mp4`
          if (!(await gcsExists(clipPath))) {
            await uploadBuffer(clipPath, Buffer.from(base64, 'base64'), 'video/mp4')
            await log(`  Uploaded scene_${sceneNum}.mp4`)
          }
        })
      )
      filteredClips.push(...filtered)
    } else {
      await log('All clips already uploaded')
    }

    // ── Step 6: Complete ────────────────────────────────────────────────────
    await log('Pipeline complete!')
    await setStep('complete')
    await updateSheet(storyId, {
      status: 'clips_ready',
      clips_generated_at: new Date().toISOString(),
      ...(filteredClips.length > 0 ? { notes: `FILTERED: ${filteredClips.length} scenes blocked — check GCS for missing clips` } : {}),
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${storyId}] Pipeline failed:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    try {
      await updateSheet(storyId, { status: 'failed', notes: `Error: ${msg}` })
    } catch { /* ignore */ }
  }
}
