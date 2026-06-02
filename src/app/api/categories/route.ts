import { NextRequest, NextResponse } from 'next/server'
import { categoriesDb, settingsDb } from '@/lib/db'
import { DEFAULT_PROMPTS } from '@/lib/pipeline/gemini'

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await categoriesDb.getAll()
  // If no categories exist, return the default KathaKar one
  if (categories.length === 0) {
    return NextResponse.json({ categories: [getKathakarDefault()] })
  }
  return NextResponse.json({ categories })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, name, emoji, description, perspective, prompt_topic_picker,
    prompt_script_writer, prompt_scene_rewrite, veo_style_suffix,
    scene_count_min, scene_count_max, is_default } = body

  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })

  try {
    const cat = await categoriesDb.upsert({
      id: id.toLowerCase().replace(/\s+/g, '_'),
      name, emoji: emoji || '🎬',
      description: description || '',
      perspective: perspective || 'third_person',
      prompt_topic_picker: prompt_topic_picker || '',
      prompt_script_writer: prompt_script_writer || '',
      prompt_scene_rewrite: prompt_scene_rewrite || '',
      veo_style_suffix: veo_style_suffix || '',
      scene_count_min: scene_count_min || 8,
      scene_count_max: scene_count_max || 10,
      is_active: true,
      is_default: is_default || false,
    })
    return NextResponse.json({ category: cat })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

function getKathakarDefault() {
  return {
    id: 'kathakar',
    name: 'KathaKar Stories',
    emoji: '🪔',
    description: 'Hindi moral stories with twist endings — raja-garib, karma, dharma',
    perspective: 'third_person',
    prompt_topic_picker: '',   // empty = use global settings
    prompt_script_writer: '',
    prompt_scene_rewrite: '',
    veo_style_suffix: '',
    scene_count_min: 8,
    scene_count_max: 10,
    is_active: true,
    is_default: true,
    created_at: new Date().toISOString(),
  }
}
