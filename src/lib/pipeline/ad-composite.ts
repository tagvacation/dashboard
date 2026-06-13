/**
 * Hybrid AI-ad compositor.
 *
 * Veo produces product-free b-roll. Here we:
 *  1. Normalize each b-roll clip to 1080x1920 h264 and overlay the REAL product cutout
 *     (with motion) + an optional Hindi caption (rendered PNGs — sharp, on-brand, never warped).
 *  2. Build a designed end-card segment (product + headline + price + CTA).
 *  3. Concat all segments, then mix Veo ambient (low) with the Hindi TTS narration.
 *  4. Upload stories/{id}/final/reel.mp4.
 *
 * Requires ffmpeg/ffprobe on the host (Railway nixpacks installs them; locally `brew install ffmpeg`).
 */
import { Storage } from '@google-cloud/storage'
import { spawn } from 'child_process'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import { readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GcpContext } from './auth'
import { downloadGsUri } from '../gcs'
import { renderCaption, renderEndcard, type EndcardSpec, AD_W, AD_H } from './overlay-render'

export interface ComposeScene {
  sceneNum: string                 // '01'
  showProduct: boolean
  productMotion: 'rise' | 'zoom' | 'center'
  captionHi?: string
}

export interface ComposeAdOpts {
  storyId: string
  scenes: ComposeScene[]           // only scenes whose clips succeeded, in order
  endcard: EndcardSpec
  productCutoutGcsUri?: string | null
  ctx: GcpContext
}

export interface ComposeMascotScene {
  sceneNum: string
  captionHi?: string
}

export interface ComposeMascotOpts {
  storyId: string
  scenes: ComposeMascotScene[]     // mascot is IN the clip; we only burn captions
  endcard: EndcardSpec
  productCutoutGcsUri?: string | null   // optional real-product reveal on the end-card
  ctx: GcpContext
}

const FPS = 30
const ENDCARD_SEC = 3.5

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', d => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`)))
  })
}

function probeHasAudio(file: string): Promise<boolean> {
  return new Promise(resolve => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout?.on('data', d => { out += d.toString() })
    p.on('close', () => resolve(out.trim().length > 0))
    p.on('error', () => resolve(false))
  })
}

function probeDuration(file: string): Promise<number> {
  return new Promise(resolve => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout?.on('data', d => { out += d.toString() })
    p.on('close', () => resolve(parseFloat(out) || 0))
    p.on('error', () => resolve(0))
  })
}

// Optional background-music bed: drop a royalty-free track in src/assets/music/.
// If none present, ads simply use dialogue + ambient (no music).
function findMusic(): string | null {
  try {
    const dir = join(process.cwd(), 'src/assets/music')
    const f = readdirSync(dir).find(x => /\.(mp3|m4a|aac|wav|ogg)$/i.test(x))
    return f ? join(dir, f) : null
  } catch { return null }
}

// Subtle cinematic grade so independently-generated clips share one look.
const GRADE = 'eq=contrast=1.06:saturation=1.12:gamma=0.97,colorbalance=rm=0.03:rh=0.04'

// Common encode flags so every segment is concat-compatible (-c copy join).
const VENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS)]
const AENC = ['-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k']

export async function composeAd({ storyId, scenes, endcard, productCutoutGcsUri, ctx }: ComposeAdOpts): Promise<string> {
  const storage = new Storage({ credentials: ctx.credentials })
  const bucket = storage.bucket(ctx.bucket)
  const work = join(tmpdir(), `adc-${storyId}-${Date.now()}`)
  await mkdir(work, { recursive: true })

  try {
    // Product cutout (transparent PNG) — lives in the default upload bucket.
    let cutoutPath: string | null = null
    if (productCutoutGcsUri) {
      cutoutPath = join(work, 'cutout.png')
      await writeFile(cutoutPath, await downloadGsUri(productCutoutGcsUri))
    }

    // Narration audio.
    const audioLocal = join(work, 'narration.mp3')
    const [audioBuf] = await bucket.file(`stories/${storyId}/audio/full_narration.mp3`).download()
    await writeFile(audioLocal, audioBuf)

    const segments: string[] = []

    // ── 1. Process each b-roll clip ─────────────────────────────────────────
    for (const scene of scenes) {
      const clipLocal = join(work, `clip_${scene.sceneNum}.mp4`)
      await writeFile(clipLocal, (await bucket.file(`stories/${storyId}/clips/scene_${scene.sceneNum}.mp4`).download())[0])
      const hasAudio = await probeHasAudio(clipLocal)

      const useProduct = scene.showProduct && !!cutoutPath
      const useCaption = !!scene.captionHi
      let captionPath: string | null = null
      if (useCaption) {
        captionPath = join(work, `cap_${scene.sceneNum}.png`)
        await writeFile(captionPath, renderCaption(scene.captionHi!))
      }

      // Inputs: 0=clip [, product] [, caption] [, silence if no audio].
      // Image overlays use -loop 1 so they're continuous streams — otherwise ffmpeg
      // grabs the single frame at t=0 (where fade alpha≈0) and repeats it → invisible.
      const inputs: string[] = ['-i', clipLocal]
      let idx = 1
      let pIdx = -1, cIdx = -1, silenceIdx = -1
      if (useProduct) { inputs.push('-loop', '1', '-i', cutoutPath!); pIdx = idx++ }
      if (useCaption) { inputs.push('-loop', '1', '-i', captionPath!); cIdx = idx++ }
      if (!hasAudio) { inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'); silenceIdx = idx++ }

      // Filter graph
      const f: string[] = []
      f.push(`[0:v]scale=${AD_W}:${AD_H}:force_original_aspect_ratio=decrease,pad=${AD_W}:${AD_H}:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]`)
      let last = 'bg'
      if (useProduct) {
        // cutout ~52% of frame height, fade in; motion via overlay y/x expressions.
        f.push(`[${pIdx}:v]scale=-1:${Math.round(AD_H * 0.52)},format=rgba,fade=in:st=0:d=0.6:alpha=1[pc]`)
        let y = '(H-h)/2'
        if (scene.productMotion === 'rise') y = `(H-h)/2 + (H-(H-h)/2)*max(0\\,1-t/1)`
        f.push(`[${last}][pc]overlay=x=(W-w)/2:y=${y}[vp]`)
        last = 'vp'
      }
      if (useCaption) {
        f.push(`[${cIdx}:v]format=rgba,fade=in:st=0.3:d=0.5:alpha=1[cap]`)
        f.push(`[${last}][cap]overlay=0:0[vc]`)
        last = 'vc'
      }
      const audioMap = hasAudio ? '0:a:0' : `${silenceIdx}:a:0`

      const procPath = join(work, `proc_${scene.sceneNum}.mp4`)
      await runFfmpeg([
        '-y', ...inputs,
        '-filter_complex', f.join(';'),
        '-map', `[${last}]`, '-map', audioMap,
        ...VENC, ...AENC, '-shortest', '-movflags', '+faststart', procPath,
      ])
      segments.push(procPath)
    }

    // ── 2. End-card segment ─────────────────────────────────────────────────
    if (cutoutPath) {
      const endcardPng = join(work, 'endcard.png')
      await writeFile(endcardPng, await renderEndcard(endcard, await readFile(cutoutPath)))
      const endcardMp4 = join(work, 'endcard.mp4')
      await runFfmpeg([
        '-y',
        '-loop', '1', '-t', String(ENDCARD_SEC), '-i', endcardPng,
        '-f', 'lavfi', '-t', String(ENDCARD_SEC), '-i', 'anullsrc=r=48000:cl=stereo',
        '-vf', `scale=${AD_W}:${AD_H},setsar=1`,
        ...VENC, ...AENC, '-movflags', '+faststart', endcardMp4,
      ])
      segments.push(endcardMp4)
    }

    // ── 3. Concat all normalized segments ───────────────────────────────────
    const concatList = join(work, 'concat.txt')
    await writeFile(concatList, segments.map(p => `file '${p}'`).join('\n'))
    const joined = join(work, 'joined.mp4')
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', joined])

    // ── 4. Mix Veo ambient (low) + Hindi narration ──────────────────────────
    const final = join(work, 'final.mp4')
    await runFfmpeg([
      '-y',
      '-i', joined,
      '-i', audioLocal,
      '-filter_complex',
      '[0:a:0]volume=0.35[amb];[1:a:0]volume=1.0[tts];[amb][tts]amix=inputs=2:duration=longest:dropout_transition=0[a]',
      '-map', '0:v:0', '-map', '[a]',
      '-c:v', 'copy', ...AENC,
      '-movflags', '+faststart', final,
    ])

    // ── 5. Upload ───────────────────────────────────────────────────────────
    const finalGcsPath = `stories/${storyId}/final/reel.mp4`
    await bucket.file(finalGcsPath).save(await readFile(final), {
      contentType: 'video/mp4', resumable: false,
      metadata: { cacheControl: 'public, max-age=3600' },
    })
    return `https://storage.googleapis.com/${ctx.bucket}/${finalGcsPath}`
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Mascot-drama compositor. The mascot is already IN each Veo clip (with native Hindi
 * dialogue audio), so we only: normalize + burn Hindi captions per scene, append an
 * optional real-product end-card, concat, and upload. Native dialogue audio is kept.
 */
export async function composeMascotAd({ storyId, scenes, endcard, productCutoutGcsUri, ctx }: ComposeMascotOpts): Promise<string> {
  const storage = new Storage({ credentials: ctx.credentials })
  const bucket = storage.bucket(ctx.bucket)
  const work = join(tmpdir(), `mas-${storyId}-${Date.now()}`)
  await mkdir(work, { recursive: true })

  try {
    const segments: string[] = []

    // 1. Normalize each scene clip + burn caption (keep native dialogue audio).
    for (const scene of scenes) {
      const clipLocal = join(work, `clip_${scene.sceneNum}.mp4`)
      await writeFile(clipLocal, (await bucket.file(`stories/${storyId}/clips/scene_${scene.sceneNum}.mp4`).download())[0])
      const hasAudio = await probeHasAudio(clipLocal)

      const inputs: string[] = ['-i', clipLocal]
      let idx = 1, cIdx = -1, silenceIdx = -1
      if (scene.captionHi) {
        const capPath = join(work, `cap_${scene.sceneNum}.png`)
        await writeFile(capPath, renderCaption(scene.captionHi))
        inputs.push('-loop', '1', '-i', capPath); cIdx = idx++
      }
      if (!hasAudio) { inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'); silenceIdx = idx++ }

      const f: string[] = [`[0:v]scale=${AD_W}:${AD_H}:force_original_aspect_ratio=decrease,pad=${AD_W}:${AD_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,${GRADE}[bg]`]
      let last = 'bg'
      if (cIdx >= 0) {
        f.push(`[${cIdx}:v]format=rgba,fade=in:st=0.3:d=0.5:alpha=1[cap]`)
        f.push(`[bg][cap]overlay=0:0[v]`)
        last = 'v'
      }
      const audioMap = hasAudio ? '0:a:0' : `${silenceIdx}:a:0`

      const procPath = join(work, `proc_${scene.sceneNum}.mp4`)
      await runFfmpeg([
        '-y', ...inputs,
        '-filter_complex', f.join(';'),
        '-map', `[${last}]`, '-map', audioMap,
        ...VENC, ...AENC, '-shortest', '-movflags', '+faststart', procPath,
      ])
      segments.push(procPath)
    }

    // 2. Optional end-card (real product reveal if a cutout exists, else text-only).
    let cutoutBuf: Buffer | null = null
    if (productCutoutGcsUri) {
      try { cutoutBuf = await downloadGsUri(productCutoutGcsUri) } catch { cutoutBuf = null }
    }
    const endcardPng = join(work, 'endcard.png')
    await writeFile(endcardPng, await renderEndcard(endcard, cutoutBuf))
    const endcardMp4 = join(work, 'endcard.mp4')
    await runFfmpeg([
      '-y',
      '-loop', '1', '-t', String(ENDCARD_SEC), '-i', endcardPng,
      '-f', 'lavfi', '-t', String(ENDCARD_SEC), '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', `scale=${AD_W}:${AD_H},setsar=1`,
      ...VENC, ...AENC, '-movflags', '+faststart', endcardMp4,
    ])
    segments.push(endcardMp4)

    // 3. Assemble: crossfade transitions between scenes + optional background music.
    //    Falls back to a plain concat if the complex graph errors, so we always ship a reel.
    const final = join(work, 'final.mp4')
    const music = findMusic()
    try {
      const durs: number[] = []
      for (const s of segments) durs.push(await probeDuration(s))
      const T = 0.4 // crossfade seconds
      const inputs: string[] = []
      for (const s of segments) inputs.push('-i', s)
      let musicIdx = -1
      if (music) { inputs.push('-stream_loop', '-1', '-i', music); musicIdx = segments.length }

      const fc: string[] = []
      let vlab = '[0:v]', alab = '[0:a]', acc = 0
      for (let i = 1; i < segments.length; i++) {
        acc += durs[i - 1]
        const off = (acc - i * T).toFixed(3)
        const vo = `[v${i}]`, ao = `[a${i}]`
        fc.push(`${vlab}[${i}:v]xfade=transition=fade:duration=${T}:offset=${off}${vo}`)
        fc.push(`${alab}[${i}:a]acrossfade=d=${T}${ao}`)
        vlab = vo; alab = ao
      }
      let aFinal = alab
      if (music) {
        fc.push(`[${musicIdx}:a]volume=0.16[mus]`)
        fc.push(`${alab}[mus]amix=inputs=2:duration=first:dropout_transition=0[amix]`)
        aFinal = '[amix]'
      }
      await runFfmpeg([
        '-y', ...inputs,
        '-filter_complex', fc.join(';'),
        '-map', vlab, '-map', aFinal,
        ...VENC, ...AENC, '-movflags', '+faststart', final,
      ])
    } catch {
      const concatList = join(work, 'concat.txt')
      await writeFile(concatList, segments.map(p => `file '${p}'`).join('\n'))
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', final])
    }

    const finalGcsPath = `stories/${storyId}/final/reel.mp4`
    await bucket.file(finalGcsPath).save(await readFile(final), {
      contentType: 'video/mp4', resumable: false,
      metadata: { cacheControl: 'public, max-age=3600' },
    })
    return `https://storage.googleapis.com/${ctx.bucket}/${finalGcsPath}`
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
