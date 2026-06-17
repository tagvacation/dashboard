import { Storage } from '@google-cloud/storage'
import { Readable } from 'stream'
import type { GcpContext } from './pipeline/auth'

/**
 * Multi-tenant storage: there is NO shared env bucket. Every operation runs against
 * a specific user/story GcpContext (their own GCS account). Build a Storage client
 * per context — do not cache a module-level client tied to env.
 */
export function bucketForContext(ctx: GcpContext) {
  const storage = new Storage({ credentials: ctx.credentials })
  return { bucket: storage.bucket(ctx.bucket), publicBase: `https://storage.googleapis.com/${ctx.bucket}` }
}

export function publicUrl(ctx: GcpContext, path: string): string {
  return `https://storage.googleapis.com/${ctx.bucket}/${path}`
}

/** Resolve the GcpContext that owns a story (its gcp_credential_id). Throws NO_GCP_ACCOUNT. */
export async function contextForStory(storyId: string): Promise<GcpContext> {
  const { sql, gcpCredentialsDb } = await import('./db')
  const { loadGcpContext, contextFromCredential } = await import('./pipeline/auth')
  const [row] = await sql<{ gcp_credential_id: string | null; user_id: string | null }[]>`
    SELECT gcp_credential_id, user_id FROM stories WHERE story_id = ${storyId}`
  if (row?.gcp_credential_id && row.gcp_credential_id !== 'default') return loadGcpContext(row.gcp_credential_id)
  // Older stories created before per-story credentials were recorded: fall back to the
  // owner's default Cloud account (their assets live in that bucket) and backfill the row.
  if (row?.user_id) {
    const cred = await gcpCredentialsDb.getDefaultForUser(row.user_id)
    if (cred) {
      await sql`UPDATE stories SET gcp_credential_id = ${cred.id} WHERE story_id = ${storyId}`.catch(() => {})
      return contextFromCredential(cred)
    }
  }
  throw new Error('NO_GCP_ACCOUNT')
}

export async function listStoryFiles(storyId: string, ctx?: GcpContext) {
  const c = ctx || await contextForStory(storyId)
  const { bucket, publicBase } = bucketForContext(c)
  const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/` })
  return files.map(f => ({
    name: f.name,
    size: parseInt(f.metadata.size as string),
    url: `${publicBase}/${f.name}`,
    type: f.name.endsWith('.mp4') ? 'video' : f.name.endsWith('.mp3') ? 'audio' : 'other',
  }))
}

export async function deleteStory(storyId: string, ctx?: GcpContext) {
  const c = ctx || await contextForStory(storyId)
  const { bucket } = bucketForContext(c)
  const [files] = await bucket.getFiles({ prefix: `stories/${storyId}/` })
  await Promise.all(files.map(f => f.delete()))
}

export function getFileStream(ctx: GcpContext, filePath: string): Readable {
  const { bucket } = bucketForContext(ctx)
  return bucket.file(filePath).createReadStream() as unknown as Readable
}

export async function fileExists(ctx: GcpContext, filePath: string) {
  const { bucket } = bucketForContext(ctx)
  const [exists] = await bucket.file(filePath).exists()
  return exists
}

/** Download a gs://bucket/path object using the given context's credentials. */
export async function downloadGsUri(gsUri: string, ctx: GcpContext): Promise<Buffer> {
  const m = gsUri.match(/^gs:\/\/([^/]+)\/(.+)$/)
  if (!m) throw new Error(`Not a gs:// URI: ${gsUri}`)
  const [, b, p] = m
  const storage = new Storage({ credentials: ctx.credentials })
  const [buf] = await storage.bucket(b).file(p).download()
  return buf
}
