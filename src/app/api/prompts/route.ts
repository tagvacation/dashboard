import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/db'
import { DEFAULT_PROMPTS } from '@/lib/pipeline/gemini'

export const dynamic = 'force-dynamic'

export async function GET() {
  const saved = await settingsDb.getAll()
  return NextResponse.json({
    topic_picker:   saved['prompt_topic_picker']   || DEFAULT_PROMPTS.topic_picker,
    script_writer:  saved['prompt_script_writer']  || DEFAULT_PROMPTS.script_writer,
    scene_rewrite:  saved['prompt_scene_rewrite']  || DEFAULT_PROMPTS.scene_rewrite,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const updates: Promise<void>[] = []

  if (body.topic_picker  !== undefined) updates.push(settingsDb.set('prompt_topic_picker',  body.topic_picker))
  if (body.script_writer !== undefined) updates.push(settingsDb.set('prompt_script_writer', body.script_writer))
  if (body.scene_rewrite !== undefined) updates.push(settingsDb.set('prompt_scene_rewrite', body.scene_rewrite))

  await Promise.all(updates)
  return NextResponse.json({ success: true })
}

export async function DELETE() {
  await Promise.all([
    settingsDb.set('prompt_topic_picker',  ''),
    settingsDb.set('prompt_script_writer', ''),
    settingsDb.set('prompt_scene_rewrite', ''),
  ])
  return NextResponse.json({ success: true, message: 'Prompts reset to defaults' })
}
