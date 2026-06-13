/**
 * ffmpeg merge — concatenates Veo clips + overlays narration audio → final reel.mp4
 *
 * Inputs:
 *   - Clips: gs://bucket/stories/{id}/clips/scene_NN.mp4
 *   - Audio: gs://bucket/stories/{id}/audio/full_narration.mp3
 *
 * Output:
 *   - Final: gs://bucket/stories/{id}/final/reel.mp4 (with audio)
 *
 * Requires ffmpeg binary on the host (Railway nixpacks installs it).
 */
import { Storage } from '@google-cloud/storage'
import { spawn } from 'child_process'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GcpContext } from './auth'

interface MergeOpts {
  storyId: string
  sceneCount: number
  ctx: GcpContext
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', d => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    })
  })
}

export async function mergeClipsWithAudio({ storyId, sceneCount, ctx }: MergeOpts): Promise<string> {
  const storage = new Storage({ credentials: ctx.credentials })
  const bucket = storage.bucket(ctx.bucket)

  const workDir = join(tmpdir(), `merge-${storyId}-${Date.now()}`)
  await mkdir(workDir, { recursive: true })

  try {
    // 1. Download all clips and audio from GCS
    const clipPaths: string[] = []
    for (let i = 1; i <= sceneCount; i++) {
      const sn = String(i).padStart(2, '0')
      const gcsPath = `stories/${storyId}/clips/scene_${sn}.mp4`
      const local = join(workDir, `scene_${sn}.mp4`)
      const [buf] = await bucket.file(gcsPath).download()
      await writeFile(local, buf)
      clipPaths.push(local)
    }

    const audioGcsPath = `stories/${storyId}/audio/full_narration.mp3`
    const audioLocal = join(workDir, 'audio.mp3')
    const [audioBuf] = await bucket.file(audioGcsPath).download()
    await writeFile(audioLocal, audioBuf)

    // 2. Build concat list (ffmpeg concat demuxer)
    const concatListPath = join(workDir, 'concat.txt')
    await writeFile(concatListPath, clipPaths.map(p => `file '${p}'`).join('\n'))

    // 3. Concat clips → concat.mp4 (keeps native Veo audio if present)
    const concatVideoPath = join(workDir, 'concat.mp4')
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      concatVideoPath,
    ])

    // 4. Probe if concat has audio (some clips are silent — older runs, story videos)
    const hasNativeAudio = await new Promise<boolean>((resolve) => {
      const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', concatVideoPath], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      p.stdout?.on('data', d => { out += d.toString() })
      p.on('close', () => resolve(out.trim().length > 0))
      p.on('error', () => resolve(false))
    })

    // 5. Mix audio:
    //    - If Veo native audio exists: amix Veo (40%) + Hindi TTS (100%) → cinematic ad
    //    - If silent: just overlay Hindi TTS (legacy behavior)
    const finalPath = join(workDir, 'final.mp4')
    if (hasNativeAudio) {
      await runFfmpeg([
        '-y',
        '-i', concatVideoPath,
        '-i', audioLocal,
        '-filter_complex',
        // amix two audio streams. Veo audio at 0.4 (SFX/ambient), narration at 1.0.
        // Use "longest" duration to match video length; pad shorter input with silence.
        '[0:a:0]volume=0.4[veo];[1:a:0]volume=1.0[tts];[veo][tts]amix=inputs=2:duration=longest:dropout_transition=0[a]',
        '-map', '0:v:0',
        '-map', '[a]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        finalPath,
      ])
    } else {
      // Legacy: video had no audio, just overlay narration
      await runFfmpeg([
        '-y',
        '-i', concatVideoPath,
        '-i', audioLocal,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        '-movflags', '+faststart',
        finalPath,
      ])
    }

    // 5. Upload final to GCS
    const finalBuf = await readFile(finalPath)
    const gcsFinalPath = `stories/${storyId}/final/reel.mp4`
    await bucket.file(gcsFinalPath).save(finalBuf, {
      contentType: 'video/mp4',
      resumable: false,
      metadata: { cacheControl: 'public, max-age=3600' },
    })

    const publicUrl = `https://storage.googleapis.com/${ctx.bucket}/${gcsFinalPath}`
    return publicUrl
  } finally {
    // Cleanup temp directory
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
