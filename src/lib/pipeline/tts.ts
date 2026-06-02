import { getAccessToken } from './auth'
import type { Scene } from './types'

export async function generateFullNarration(scenes: Scene[]): Promise<Buffer> {
  const parts = scenes.map((scene, i) => {
    const isLast = i === scenes.length - 1
    const isTwist = scene.beat === 'twist'
    const isHook = i === 0

    const breakTag = isLast ? '' :
      isTwist ? '<break time="900ms"/>' :
      isHook  ? '<break time="500ms"/>' :
                '<break time="400ms"/>'

    const text = isTwist
      ? `<emphasis level="strong">${scene.tts_text}</emphasis>`
      : scene.tts_text

    return text + breakTag
  }).join(' ')

  const ssml = `<speak>${parts}</speak>`

  const token = await getAccessToken()
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: 'hi-IN', name: 'hi-IN-Chirp3-HD-Algenib' },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  })
  if (!res.ok) throw new Error(`TTS error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!data.audioContent) throw new Error('TTS returned no audio content')
  return Buffer.from(data.audioContent, 'base64')
}
