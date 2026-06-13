import { getAccessToken } from './auth'
import type { GcpContext } from './auth'
import type { Scene } from './types'
import { fetchWithRetry } from './fetch-retry'

async function ttsCall(ssml: string, ctx: GcpContext): Promise<Buffer> {
  const token = await getAccessToken(ctx)
  const res = await fetchWithRetry('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: 'hi-IN', name: 'hi-IN-Chirp3-HD-Algenib' },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  }, { label: 'tts', timeoutMs: 90_000 })
  if (!res.ok) throw new Error(`TTS error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!data.audioContent) throw new Error('TTS returned no audio content')
  return Buffer.from(data.audioContent, 'base64')
}

export async function generateFullNarration(scenes: Scene[], ctx: GcpContext): Promise<Buffer> {
  // Build SSML pieces per scene
  const pieces = scenes.map((scene, i) => {
    const isLast = i === scenes.length - 1
    const isTwist = scene.beat === 'twist' || scene.beat === 'reversal' || scene.beat === 'payoff'
    const isHook = i === 0

    const breakTag = isLast ? '' :
      isTwist ? '<break time="900ms"/>' :
      isHook  ? '<break time="500ms"/>' :
                '<break time="400ms"/>'

    const text = isTwist
      ? `<emphasis level="strong">${scene.tts_text}</emphasis>`
      : scene.tts_text

    return text + breakTag
  })

  // Cloud TTS limit is 5000 bytes per request. Hindi Devanagari uses 3-4 bytes per
  // character (UTF-8), so longer scripts overflow. Bin-pack pieces into <4500 byte
  // chunks, synthesize each, concat MP3 buffers.
  const chunks: string[] = []
  let current: string[] = []
  let currentBytes = 0
  const LIMIT = 4500 - 20 // leave room for <speak></speak> wrapper

  for (const piece of pieces) {
    const pBytes = Buffer.byteLength(piece + ' ', 'utf-8')
    if (currentBytes + pBytes > LIMIT && current.length > 0) {
      chunks.push(current.join(' '))
      current = []
      currentBytes = 0
    }
    current.push(piece)
    currentBytes += pBytes
  }
  if (current.length) chunks.push(current.join(' '))

  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    const ssml = `<speak>${chunk}</speak>`
    buffers.push(await ttsCall(ssml, ctx))
  }
  return Buffer.concat(buffers)
}
