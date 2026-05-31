import { Storage } from '@google-cloud/storage'

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

export async function getFileStream(filePath: string) {
  return bucket.file(filePath).createReadStream()
}

export async function fileExists(filePath: string) {
  const [exists] = await bucket.file(filePath).exists()
  return exists
}
