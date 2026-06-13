import { Storage } from '@google-cloud/storage'
import { Readable } from 'stream'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)

export const BUCKET_NAME = process.env.GCS_BUCKET!
export const PUBLIC_BASE = `https://storage.googleapis.com/${BUCKET_NAME}`

export async function listStoryFiles(storyId: string) {
  const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/` })
  return files.map(f => ({
    name: f.name,
    size: parseInt(f.metadata.size as string),
    url: `${PUBLIC_BASE}/${f.name}`,
    type: f.name.endsWith('.mp4') ? 'video' : f.name.endsWith('.mp3') ? 'audio' : 'other',
  }))
}

export async function deleteStory(storyId: string) {
  const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/` })
  await Promise.all(files.map(f => f.delete()))
}

export function getFileStream(filePath: string): Readable {
  return bucket.file(filePath).createReadStream() as unknown as Readable
}

export async function fileExists(filePath: string) {
  const [exists] = await bucket.file(filePath).exists()
  return exists
}

/**
 * Download any gs://bucket/path object using the default (env) credentials.
 * Used for ad reference images/cutouts, which always live in the default upload
 * bucket even when the generation pipeline runs under a different cloud account.
 */
export async function downloadGsUri(gsUri: string): Promise<Buffer> {
  const m = gsUri.match(/^gs:\/\/([^/]+)\/(.+)$/)
  if (!m) throw new Error(`Not a gs:// URI: ${gsUri}`)
  const [, b, p] = m
  const [buf] = await storage.bucket(b).file(p).download()
  return buf
}
